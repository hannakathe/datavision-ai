// Reglas de gestión de conjuntos compartidas por el servidor (SQLite) y el modo navegador (IndexedDB).
import { badRequest } from './errors.js';
import { TYPES } from './types.js';
import { buildDataset, revalidate } from './ingest.js';
import { cleanRows } from './clean.js';

export function textField(v, max, field) {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw badRequest(`El campo «${field}» debe ser texto.`);
  return v.trim().slice(0, max);
}

export function requireName(name) {
  const n = textField(name, 120, 'nombre');
  if (!n) throw badRequest('El nombre del conjunto de datos es obligatorio.');
  return n;
}

// Valida la carga del editor manual y la convierte en un conjunto normalizado.
export function manualDataset(body, limits) {
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
  const ds = buildDataset({ columns, rows }, limits);
  if (!ds.rows.length) throw badRequest('Agrega al menos una fila con datos.');
  return ds;
}

// Devuelve un esquema nuevo con los tipos elegidos por el usuario.
export function applyColumnTypes(schema, columnTypes) {
  if (!columnTypes || typeof columnTypes !== 'object') throw badRequest('columnTypes debe ser un objeto {columna: tipo}.');
  const next = structuredClone(schema);
  for (const [colName, type] of Object.entries(columnTypes)) {
    const col = next.columns.find((c) => c.name === colName);
    if (!col) throw badRequest(`La columna «${colName}» no existe.`);
    if (!TYPES.includes(type)) throw badRequest(`Tipo «${type}» no válido. Tipos: ${TYPES.join(', ')}.`);
    col.type = type;
    if (col.role !== 'identificador') col.role = { numerico: 'medida', fecha: 'tiempo', texto: 'atributo' }[type] || 'dimension';
    col.discrete = type === 'numerico' && col.unique <= 12;
  }
  return next;
}

// Aplica las correcciones elegidas y recalcula esquema y validación conservando los tipos cambiados manualmente.
export function cleanedDataset(dataset, rows, body, limits) {
  const { rows: cleaned, report } = cleanRows(rows, dataset.schema, body);
  if (!report.length) throw badRequest('Selecciona al menos una corrección para aplicar.');
  const ds = buildDataset({ columns: dataset.columns, rows: cleaned }, limits);
  for (const col of ds.schema.columns) {
    const prev = dataset.schema.columns.find((c) => c.name === col.name);
    if (prev && prev.type !== prev.detectedType) col.type = prev.type;
  }
  ds.validation = revalidate(ds.rows, ds.schema, report);
  return { ds, report };
}
