// Modo navegador: implementa la misma API que el servidor, pero guarda en IndexedDB y procesa los archivos en el navegador.
// Se usa automáticamente cuando no hay servidor Node (por ejemplo, en GitHub Pages).
import { badRequest, notFound } from './core/errors.js';
import { parseCsv, parseJson, parseXlsx } from './core/parsers.js';
import { buildDataset, revalidate, DEFAULT_LIMITS } from './core/ingest.js';
import { requireName, textField, manualDataset, applyColumnTypes, cleanedDataset } from './core/manage.js';
import { sanitizeConfig } from './core/dashboard.js';
import { DEMO_DATASETS } from './core/demo-list.js';

const LIMITS = { ...DEFAULT_LIMITS, maxUploadMb: 5 };
const DB_NAME = 'datavision-ai';

// ---------- Librerías bajo demanda ----------
const scripts = new Map();
function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve(window[globalName]);
      s.onerror = () => reject(new Error(`No se pudo cargar ${src}.`));
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}
const papa = () => loadScript('vendor/papaparse/papaparse.min.js', 'Papa');
const excel = () => loadScript('vendor/exceljs/exceljs.min.js', 'ExcelJS');

// ---------- IndexedDB ----------
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('datasets', { keyPath: 'id', autoIncrement: true });
        d.createObjectStore('rows');
        d.createObjectStore('dashboards', { keyPath: 'id', autoIncrement: true }).createIndex('datasetId', 'datasetId');
        d.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new Error('El navegador no permite guardar datos (IndexedDB no disponible, ¿modo privado?).'));
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    let result;
    Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error || new Error('Error al guardar en el navegador.'));
    t.onabort = () => reject(t.error || new Error('Operación cancelada (¿sin espacio de almacenamiento?).'));
  });
}

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const now = () => new Date().toISOString();

async function getMeta(id) {
  const d = await tx('datasets', 'readonly', (s) => req(s.get(Number(id))));
  if (!d) throw notFound('El conjunto de datos no existe.');
  return d;
}

async function getRows(id) {
  return (await tx('rows', 'readonly', (s) => req(s.get(Number(id))))) || [];
}

function metaFrom(ds, extra) {
  return {
    description: '', sourceDetail: '', isDemo: false, ...extra,
    rowCount: ds.rows.length, columnCount: ds.columns.length, columns: ds.columns,
    schema: ds.schema, validation: ds.validation, status: ds.validation.status,
  };
}

async function createDataset(ds, extra) {
  const t = now();
  const meta = { ...metaFrom(ds, extra), createdAt: t, updatedAt: t };
  const id = await tx(['datasets', 'rows'], 'readwrite', async (s, r) => {
    const newId = await req(s.add(meta));
    r.put(ds.rows, newId);
    return newId;
  });
  return getMeta(id);
}

async function replaceData(id, ds, patch = {}) {
  const current = await getMeta(id);
  const meta = { ...current, ...metaFrom(ds, {}), ...patch, id: current.id, name: patch.name ?? current.name, description: patch.description ?? current.description, sourceType: current.sourceType, sourceDetail: current.sourceDetail, isDemo: current.isDemo, createdAt: current.createdAt, updatedAt: now() };
  await tx(['datasets', 'rows'], 'readwrite', (s, r) => { s.put(meta); r.put(ds.rows, current.id); });
  return getMeta(id);
}

async function putMeta(meta) {
  await tx('datasets', 'readwrite', (s) => req(s.put({ ...meta, updatedAt: now() })));
  return getMeta(meta.id);
}

// ---------- Importación ----------
const previews = new Map();

async function parseBytes(bytes, filename, opts = {}) {
  const ext = (filename.match(/\.[^.]+$/)?.[0] || '').toLowerCase();
  if (['.csv', '.tsv', '.txt'].includes(ext)) return { ...parseCsv(bytes, await papa()), format: 'csv' };
  if (ext === '.json') return { ...parseJson(bytes), format: 'json' };
  if (ext === '.xlsx') return { ...(await parseXlsx(bytes, await excel(), opts)), format: 'xlsx' };
  if (['.db', '.sqlite', '.sqlite3'].includes(ext)) throw badRequest('La importación de archivos SQLite solo está disponible en la versión local (npm start). Exporta la tabla a CSV para usarla aquí.');
  throw badRequest(`Formato «${ext || 'sin extensión'}» no soportado. Formatos aceptados: .csv, .tsv, .txt, .json, .xlsx.`);
}

async function preview(form) {
  const file = form.get('archivo');
  if (!file || !file.size) throw badRequest('Selecciona un archivo para importar (no puede estar vacío).');
  if (file.size > LIMITS.maxUploadMb * 1024 * 1024) throw badRequest(`El archivo supera el tamaño máximo de ${LIMITS.maxUploadMb} MB.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const parsed = await parseBytes(bytes, file.name, { sheet: form.get('sheet') || undefined });
  const ds = buildDataset(parsed, LIMITS);
  const uploadId = crypto.randomUUID();
  previews.clear();
  previews.set(uploadId, { ds, filename: file.name, format: parsed.format, meta: parsed.meta || {} });
  return { uploadId, fileName: file.name, format: parsed.format, meta: parsed.meta || {}, columns: ds.columns, schema: ds.schema, validation: ds.validation, rowCount: ds.rows.length, previewRows: ds.rows.slice(0, 20) };
}

async function commit({ uploadId, name, description }) {
  const p = previews.get(uploadId);
  if (!p) throw badRequest('La vista previa expiró o no existe. Vuelve a seleccionar el archivo.');
  if (!p.ds.rows.length) throw badRequest('No se puede guardar un conjunto de datos sin filas.');
  const detail = [p.filename, p.meta.sheet && `hoja ${p.meta.sheet}`].filter(Boolean).join(' · ');
  const d = await createDataset(p.ds, { name: requireName(name), description: textField(description, 500, 'descripción') || '', sourceType: p.format, sourceDetail: detail });
  previews.delete(uploadId);
  return d;
}

async function loadDemo() {
  const existing = new Set((await list()).filter((d) => d.isDemo).map((d) => d.sourceDetail));
  const loaded = [];
  for (const demo of DEMO_DATASETS) {
    if (existing.has(demo.file)) continue;
    const res = await fetch(`data/demo/${demo.file}`);
    if (!res.ok) throw new Error(`No se encontró el archivo de demostración ${demo.file}.`);
    const parsed = await parseBytes(new Uint8Array(await res.arrayBuffer()), demo.file);
    const d = await createDataset(buildDataset(parsed, LIMITS), { name: demo.name, description: demo.description, sourceType: parsed.format, sourceDetail: demo.file, isDemo: true });
    loaded.push(d.name);
  }
  await tx('meta', 'readwrite', (s) => s.put(now(), 'demo_seeded'));
  return { loaded };
}

async function list() {
  const all = await tx('datasets', 'readonly', (s) => req(s.getAll()));
  return all
    .map((d) => ({ ...d, validation: { ...d.validation, byColumn: undefined } }))
    .sort((a, b) => a.isDemo - b.isDemo || b.updatedAt.localeCompare(a.updatedAt));
}

async function dashboardsOf(datasetId) {
  const all = await tx('dashboards', 'readonly', (s) => req(s.index('datasetId').getAll(Number(datasetId))));
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getDashboard(id) {
  const d = await tx('dashboards', 'readonly', (s) => req(s.get(Number(id))));
  if (!d) throw notFound('La configuración no existe.');
  return d;
}

export const localApi = {
  mode: 'browser',

  async ensureSeed() {
    const seeded = await tx('meta', 'readonly', (s) => req(s.get('demo_seeded')));
    if (!seeded) await loadDemo();
  },

  importers: async () => ({
    importers: [
      { id: 'csv', label: 'Archivo CSV / TSV', extensions: ['.csv', '.tsv', '.txt'], status: 'disponible' },
      { id: 'json', label: 'Archivo JSON', extensions: ['.json'], status: 'disponible' },
      { id: 'xlsx', label: 'Libro de Excel (.xlsx)', extensions: ['.xlsx'], status: 'disponible' },
      { id: 'manual', label: 'Editor manual en la interfaz', extensions: [], status: 'disponible' },
      { id: 'console', label: 'Consola de datos en la interfaz', extensions: [], status: 'disponible' },
      { id: 'sqlite', label: 'Base de datos SQLite (archivo .db/.sqlite)', extensions: [], status: 'solo_local' },
      { id: 'cli', label: 'Consola de Node.js (npm run import)', extensions: [], status: 'solo_local' },
      { id: 'rest', label: 'API REST', extensions: [], status: 'planificado' },
      { id: 'sql-server', label: 'PostgreSQL / MySQL / SQL Server', extensions: [], status: 'planificado' },
    ],
    limits: LIMITS,
  }),
  preview,
  commit,
  datasets: list,
  dataset: getMeta,
  rows: async (id) => {
    const rows = await getRows(id);
    return { total: rows.length, offset: 0, rows };
  },
  createDataset: async (body) => createDataset(manualDataset(body, LIMITS), {
    name: requireName(body.name), description: textField(body.description, 500, 'descripción') || '', sourceType: 'manual', sourceDetail: body.source === 'consola' ? 'Consola de datos' : 'Editor manual',
  }),
  replaceRows: async (id, body) => replaceData(id, manualDataset(body, LIMITS), { name: body.name !== undefined ? requireName(body.name) : undefined, description: textField(body.description, 500, 'descripción') }),
  async updateDataset(id, body) {
    let meta = await getMeta(id);
    if (body.name !== undefined) meta.name = requireName(body.name);
    if (body.description !== undefined) meta.description = textField(body.description, 500, 'descripción');
    if (body.columnTypes !== undefined) {
      meta.schema = applyColumnTypes(meta.schema, body.columnTypes);
      meta.validation = revalidate(await getRows(id), meta.schema, meta.validation.importWarnings);
      meta.status = meta.validation.status;
    }
    meta = await putMeta(meta);
    return meta;
  },
  async cleanDataset(id, body = {}) {
    const d = await getMeta(id);
    const { ds, report } = cleanedDataset(d, await getRows(id), body, LIMITS);
    if (body.mode === 'replace') return { dataset: await replaceData(id, ds), report };
    const dataset = await createDataset(ds, { name: requireName(body.name || `${d.name} (limpio)`), description: d.description, sourceType: 'limpieza', sourceDetail: `Derivado del conjunto #${d.id}` });
    return { dataset, report };
  },
  async deleteDataset(id) {
    await getMeta(id);
    const dashes = await dashboardsOf(id);
    await tx(['datasets', 'rows', 'dashboards'], 'readwrite', (s, r, g) => { s.delete(Number(id)); r.delete(Number(id)); dashes.forEach((x) => g.delete(x.id)); });
    return null;
  },
  async exportCsv(id) {
    const d = await getMeta(id);
    const rows = await getRows(id);
    const Papa = await papa();
    return { name: d.name, csv: Papa.unparse({ fields: d.columns, data: rows.map((r) => d.columns.map((c) => r[c])) }, { escapeFormulae: true }) };
  },
  dashboards: dashboardsOf,
  async saveDashboard(datasetId, body) {
    const d = await getMeta(datasetId);
    const name = String(body?.name || '').trim().slice(0, 120);
    if (!name) throw badRequest('Escribe un nombre para la configuración.');
    const t = now();
    const id = await tx('dashboards', 'readwrite', (s) => req(s.add({ datasetId: d.id, name, config: sanitizeConfig(body.config, d.schema), createdAt: t, updatedAt: t })));
    return getDashboard(id);
  },
  async updateDashboard(id, body) {
    const dash = await getDashboard(id);
    const d = await getMeta(dash.datasetId);
    if (body.name !== undefined && !String(body.name).trim()) throw badRequest('El nombre no puede estar vacío.');
    const next = { ...dash, name: body.name !== undefined ? String(body.name).trim().slice(0, 120) : dash.name, config: body.config ? sanitizeConfig(body.config, d.schema) : dash.config, updatedAt: now() };
    await tx('dashboards', 'readwrite', (s) => req(s.put(next)));
    return next;
  },
  async deleteDashboard(id) {
    await getDashboard(id);
    await tx('dashboards', 'readwrite', (s) => req(s.delete(Number(id))));
    return null;
  },
  loadDemo,
};
