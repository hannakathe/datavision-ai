// Normaliza filas importadas (de cualquier origen), aplica límites y calcula esquema + validación.
import { config } from '../config.js';
import { badRequest } from '../errors.js';
import { inferSchema } from '../../public/js/core/types.js';
import { analyzeQuality } from '../../public/js/core/quality.js';

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeHeaders(raw) {
  const used = new Set();
  return raw.map((h, i) => {
    let name = (h === null || h === undefined ? '' : String(h)).replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!name) name = `columna_${i + 1}`;
    if (FORBIDDEN_KEYS.has(name)) name = `${name}_col`;
    let unique = name;
    let k = 2;
    while (used.has(unique.toLowerCase())) unique = `${name}_${k++}`;
    used.add(unique.toLowerCase());
    return unique;
  });
}

function normalizeCell(v, stats) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  s = s.replace(CONTROL_CHARS, '');
  if (s.length > config.maxCellLength) { stats.truncated++; s = s.slice(0, config.maxCellLength); }
  return s;
}

/**
 * @param {{columns: any[], rows: (any[]|object)[], warnings?: string[]}} input
 * Las filas pueden ser arreglos (alineados con columns) u objetos (claves = columns originales).
 */
export function buildDataset({ columns: rawColumns, rows: rawRows, warnings = [] }) {
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) throw badRequest('No se detectaron columnas. Verifica que la primera fila contenga los encabezados.');
  if (rawColumns.length > config.maxColumns) throw badRequest(`El conjunto tiene ${rawColumns.length} columnas; el máximo permitido es ${config.maxColumns}.`);
  if (!Array.isArray(rawRows)) throw badRequest('Las filas deben enviarse como una lista.');
  if (rawRows.length > config.maxRows) throw badRequest(`El conjunto tiene ${rawRows.length} filas; el máximo permitido es ${config.maxRows}.`);

  const columns = normalizeHeaders(rawColumns);
  const stats = { truncated: 0, empty: 0, extra: 0 };
  const rows = [];
  for (const raw of rawRows) {
    const row = {};
    let hasValue = false;
    columns.forEach((name, i) => {
      const v = normalizeCell(Array.isArray(raw) ? raw[i] : raw?.[rawColumns[i]], stats);
      if (v !== null && v !== '') hasValue = true;
      row[name] = v;
    });
    if (Array.isArray(raw) && raw.length > columns.length && raw.slice(columns.length).some((v) => v !== null && v !== '')) stats.extra++;
    if (hasValue) rows.push(row);
    else stats.empty++;
  }
  const notes = [...warnings];
  if (stats.empty) notes.push(`Se omitieron ${stats.empty} fila(s) completamente vacía(s).`);
  if (stats.extra) notes.push(`${stats.extra} fila(s) tenían más valores que encabezados; los valores sobrantes se descartaron.`);
  if (stats.truncated) notes.push(`${stats.truncated} celda(s) superaban ${config.maxCellLength} caracteres y se recortaron.`);
  if (columns.some((c, i) => c !== String(rawColumns[i] ?? '').trim())) notes.push('Algunos encabezados vacíos, repetidos o reservados se renombraron automáticamente.');

  const schema = inferSchema(columns, rows);
  const validation = analyzeQuality(rows, schema);
  validation.importWarnings = notes;
  return { columns, rows, schema, validation };
}

// Recalcula la validación tras cambiar tipos de columna o datos.
export function revalidate(rows, schema, importWarnings = []) {
  const validation = analyzeQuality(rows, schema);
  validation.importWarnings = importWarnings;
  return validation;
}
