// Lógica de negocio de conjuntos de datos: importación, edición, tipos, limpieza, consulta segura y exportación.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { badRequest, notFound } from '../errors.js';
import { parseFile } from '../importers/index.js';
import { buildDataset, revalidate } from './ingest.js';
import { TYPES, isMissing, convertValue } from '../../public/js/core/types.js';
import { rowKey } from '../../public/js/core/quality.js';
import { prepare, applyFilters } from '../../public/js/core/data.js';
import { mean, median } from '../../public/js/core/stats.js';

const text = (v, max, field) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest(`El campo «${field}» debe ser texto.`);
  return v.trim().slice(0, max);
};

export function requireName(name) {
  const n = text(name, 120, 'nombre');
  if (!n) throw badRequest('El nombre del conjunto de datos es obligatorio.');
  return n;
}

// ---------- Vista previa de archivos (caché temporal en memoria) ----------
const previews = new Map();
const PREVIEW_TTL = 20 * 60 * 1000;

function prunePreviews() {
  const t = Date.now();
  for (const [k, v] of previews) if (v.expires < t) previews.delete(k);
  while (previews.size > 20) previews.delete(previews.keys().next().value);
}

export async function createPreview({ buffer, filename, sheet, table }) {
  const parsed = await parseFile(buffer, filename, { sheet: text(sheet, 200, 'hoja'), table: text(table, 200, 'tabla') });
  const ds = buildDataset(parsed);
  prunePreviews();
  const uploadId = crypto.randomUUID();
  previews.set(uploadId, { ds, filename, format: parsed.format, meta: parsed.meta || {}, expires: Date.now() + PREVIEW_TTL });
  return {
    uploadId,
    fileName: filename,
    format: parsed.format,
    meta: parsed.meta || {},
    columns: ds.columns,
    schema: ds.schema,
    validation: ds.validation,
    rowCount: ds.rows.length,
    previewRows: ds.rows.slice(0, 20),
  };
}

export function commitPreview(store, { uploadId, name, description }) {
  const p = previews.get(String(uploadId || ''));
  if (!p) throw badRequest('La vista previa expiró o no existe. Vuelve a seleccionar el archivo.');
  if (!p.ds.rows.length) throw badRequest('No se puede guardar un conjunto de datos sin filas.');
  const detail = [p.filename, p.meta.sheet && `hoja ${p.meta.sheet}`, p.meta.table && `tabla ${p.meta.table}`].filter(Boolean).join(' · ');
  const id = store.createDataset({ ...p.ds, name: requireName(name), description: text(description, 500, 'descripción') || '', sourceType: p.format, sourceDetail: detail });
  previews.delete(uploadId);
  return store.getDataset(id);
}

// Importación directa (consola y datos de demostración).
export async function importFromPath(store, file, { name, description = '', sheet, table, isDemo = false, sourceType } = {}) {
  const buffer = fs.readFileSync(file);
  const parsed = await parseFile(buffer, file, { sheet, table });
  const ds = buildDataset(parsed);
  if (!ds.rows.length) throw badRequest('El archivo no contiene filas con datos.');
  const id = store.createDataset({
    ...ds,
    name: requireName(name || path.basename(file, path.extname(file))),
    description,
    sourceType: sourceType || parsed.format,
    sourceDetail: [path.basename(file), parsed.meta?.table && `tabla ${parsed.meta.table}`].filter(Boolean).join(' · '),
    isDemo,
  });
  return store.getDataset(id);
}

// ---------- Entrada manual ----------
function parseManualPayload(body) {
  if (!Array.isArray(body?.columns) || !body.columns.length) throw badRequest('Define al menos una columna.');
  const columns = body.columns.map((c) => (typeof c === 'string' ? c : ''));
  if (columns.some((c) => !c.trim())) throw badRequest('Todas las columnas deben tener nombre.');
  const lower = columns.map((c) => c.trim().toLowerCase());
  if (new Set(lower).size !== lower.length) throw badRequest('Hay nombres de columna repetidos.');
  if (!Array.isArray(body.rows)) throw badRequest('Las filas deben enviarse como una lista.');
  const rows = body.rows.map((r) => {
    if (!Array.isArray(r)) throw badRequest('Cada fila debe ser una lista de valores.');
    return r.map((v) => (v === null || v === undefined ? null : typeof v === 'number' || typeof v === 'boolean' ? v : String(v)));
  });
  const ds = buildDataset({ columns, rows });
  if (!ds.rows.length) throw badRequest('Agrega al menos una fila con datos.');
  return ds;
}

export function createManual(store, body) {
  const ds = parseManualPayload(body);
  const id = store.createDataset({ ...ds, name: requireName(body.name), description: text(body.description, 500, 'descripción') || '', sourceType: 'manual', sourceDetail: 'Editor manual' });
  return store.getDataset(id);
}

export function replaceManual(store, id, body) {
  const current = mustGet(store, id);
  const ds = parseManualPayload(body);
  store.replaceData(id, ds);
  store.updateMeta(id, { name: body.name !== undefined ? requireName(body.name) : current.name, description: text(body.description, 500, 'descripción') });
  return store.getDataset(id);
}

// ---------- Gestión ----------
export function mustGet(store, id) {
  const d = store.getDataset(id);
  if (!d) throw notFound('El conjunto de datos no existe.');
  return d;
}

export function updateDataset(store, id, body) {
  const d = mustGet(store, id);
  if (body.name !== undefined || body.description !== undefined) {
    store.updateMeta(id, { name: body.name !== undefined ? requireName(body.name) : undefined, description: text(body.description, 500, 'descripción') });
  }
  if (body.columnTypes !== undefined) {
    if (!body.columnTypes || typeof body.columnTypes !== 'object') throw badRequest('columnTypes debe ser un objeto {columna: tipo}.');
    const schema = structuredClone(d.schema);
    for (const [colName, type] of Object.entries(body.columnTypes)) {
      const col = schema.columns.find((c) => c.name === colName);
      if (!col) throw badRequest(`La columna «${colName}» no existe.`);
      if (!TYPES.includes(type)) throw badRequest(`Tipo «${type}» no válido. Tipos: ${TYPES.join(', ')}.`);
      col.type = type;
      if (col.role !== 'identificador') col.role = { numerico: 'medida', fecha: 'tiempo', texto: 'atributo' }[type] || 'dimension';
      col.discrete = type === 'numerico' && col.unique <= 12;
    }
    const rows = store.getRows(id);
    store.updateSchema(id, schema, revalidate(rows, schema, d.validation.importWarnings));
  }
  return store.getDataset(id);
}

const MISSING_STRATEGIES = ['drop', 'fill_value', 'fill_mean', 'fill_median', 'fill_mode'];

export function cleanRows(rows, schema, { removeDuplicates = false, missing = [] } = {}) {
  let out = rows.map((r) => ({ ...r }));
  const report = [];
  const columns = schema.columns.map((c) => c.name);
  if (removeDuplicates) {
    const seen = new Set();
    const before = out.length;
    out = out.filter((r) => { const k = rowKey(r, columns); if (seen.has(k)) return false; seen.add(k); return true; });
    report.push(`Se eliminaron ${before - out.length} fila(s) duplicada(s).`);
  }
  if (!Array.isArray(missing)) throw badRequest('missing debe ser una lista de reglas.');
  for (const rule of missing) {
    const col = schema.columns.find((c) => c.name === rule?.column);
    if (!col) throw badRequest(`La columna «${rule?.column}» no existe.`);
    if (!MISSING_STRATEGIES.includes(rule.strategy)) throw badRequest(`Estrategia no válida para «${col.name}».`);
    const name = col.name;
    const missingCount = out.filter((r) => isMissing(r[name])).length;
    if (!missingCount) continue;
    if (rule.strategy === 'drop') {
      out = out.filter((r) => !isMissing(r[name]));
      report.push(`«${name}»: se eliminaron ${missingCount} fila(s) con valor vacío.`);
      continue;
    }
    let fill;
    if (rule.strategy === 'fill_value') {
      fill = text(String(rule.value ?? ''), 200, 'valor');
      if (!fill) throw badRequest(`Indica el valor de reemplazo para «${name}».`);
    } else if (rule.strategy === 'fill_mode') {
      const counts = new Map();
      for (const r of out) if (!isMissing(r[name])) counts.set(r[name], (counts.get(r[name]) || 0) + 1);
      fill = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    } else {
      if (col.type !== 'numerico') throw badRequest(`«${name}» no es numérica: no se puede usar promedio ni mediana.`);
      const nums = out.map((r) => convertValue(r[name], 'numerico'));
      const v = rule.strategy === 'fill_mean' ? mean(nums) : median(nums);
      fill = v === null ? undefined : Math.round(v * 10000) / 10000;
    }
    if (fill === undefined) throw badRequest(`No hay valores en «${name}» para calcular el reemplazo.`);
    for (const r of out) if (isMissing(r[name])) r[name] = fill;
    report.push(`«${name}»: ${missingCount} valor(es) vacío(s) reemplazado(s) por ${JSON.stringify(fill)}.`);
  }
  return { rows: out, report };
}

export function cleanDataset(store, id, body = {}) {
  const d = mustGet(store, id);
  const { rows, report } = cleanRows(store.getRows(id), d.schema, body);
  if (!report.length) throw badRequest('Selecciona al menos una corrección para aplicar.');
  const ds = buildDataset({ columns: d.columns, rows });
  // Conserva los tipos que el usuario haya cambiado manualmente.
  for (const col of ds.schema.columns) {
    const prev = d.schema.columns.find((c) => c.name === col.name);
    if (prev && prev.type !== prev.detectedType) col.type = prev.type;
  }
  ds.validation = revalidate(ds.rows, ds.schema, report);
  if (body.mode === 'replace') {
    store.replaceData(id, ds);
    return { dataset: store.getDataset(id), report };
  }
  const newId = store.createDataset({ ...ds, name: requireName(body.name || `${d.name} (limpio)`), description: d.description, sourceType: 'limpieza', sourceDetail: `Derivado del conjunto #${d.id}` });
  return { dataset: store.getDataset(newId), report };
}

// Consulta estructurada y segura (sin SQL libre): filtros, búsqueda, orden y paginación.
export function queryDataset(store, id, body = {}) {
  const d = mustGet(store, id);
  const rows = store.getRows(id);
  const prep = prepare(rows, d.schema);
  const idx = applyFilters(prep, Array.isArray(body.filters) ? body.filters : [], typeof body.search === 'string' ? body.search : '');
  const sortCol = body.sort?.column;
  if (sortCol !== undefined) {
    if (!prep.colMap[sortCol]) throw badRequest(`No se puede ordenar: la columna «${sortCol}» no existe.`);
    const dir = body.sort.dir === 'desc' ? -1 : 1;
    const col = prep.cols[sortCol];
    idx.sort((a, b) => (col[a] === null) - (col[b] === null) || (col[a] < col[b] ? -dir : col[a] > col[b] ? dir : 0));
  }
  const offset = Math.max(0, Number(body.offset) || 0);
  const limit = Math.min(500, Math.max(1, Number(body.limit) || 50));
  let columns = d.columns;
  if (Array.isArray(body.columns) && body.columns.length) {
    const bad = body.columns.find((c) => !d.columns.includes(c));
    if (bad) throw badRequest(`La columna «${bad}» no existe.`);
    columns = body.columns;
  }
  return {
    total: idx.length,
    offset,
    limit,
    columns,
    rows: idx.slice(offset, offset + limit).map((i) => Object.fromEntries(columns.map((c) => [c, rows[i][c]]))),
  };
}

export function exportCsv(store, id) {
  const d = mustGet(store, id);
  // escapeFormulae antepone ' a celdas que empiezan con = + - @ para evitar inyección de fórmulas al abrir en Excel.
  return { name: d.name, csv: Papa.unparse({ fields: d.columns, data: store.getRows(id).map((r) => d.columns.map((c) => r[c])) }, { escapeFormulae: true }) };
}
