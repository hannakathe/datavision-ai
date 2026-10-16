// Lógica de negocio de conjuntos de datos: importación, edición, tipos, limpieza, consulta segura y exportación.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { badRequest, notFound } from '../errors.js';
import { parseFile } from '../importers/index.js';
import { buildDataset, revalidate } from './ingest.js';
import { cleanRows } from '../../public/js/core/clean.js';
import { textField, requireName, manualDataset, applyColumnTypes, cleanedDataset } from '../../public/js/core/manage.js';
import { config } from '../config.js';
import { prepare, applyFilters } from '../../public/js/core/data.js';

const text = textField;
export { requireName };

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
const parseManualPayload = (body) => manualDataset(body, config);

export function createManual(store, body) {
  const ds = parseManualPayload(body);
  const id = store.createDataset({ ...ds, name: requireName(body.name), description: text(body.description, 500, 'descripción') || '', sourceType: 'manual', sourceDetail: body.source === 'consola' ? 'Consola de datos' : 'Editor manual' });
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
    const schema = applyColumnTypes(d.schema, body.columnTypes);
    const rows = store.getRows(id);
    store.updateSchema(id, schema, revalidate(rows, schema, d.validation.importWarnings));
  }
  return store.getDataset(id);
}

export { cleanRows };

export function cleanDataset(store, id, body = {}) {
  const d = mustGet(store, id);
  const { ds, report } = cleanedDataset(d, store.getRows(id), body, config);
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
