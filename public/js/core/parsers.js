// Lectores de CSV, JSON y XLSX compartidos por el servidor y el modo navegador.
// Las librerías (papaparse, exceljs) se inyectan para que el mismo código funcione en Node y en el navegador.
import { badRequest } from './errors.js';

export function decodeText(bytes) {
  let text = new TextDecoder('utf-8').decode(bytes);
  if (text.includes('�')) text = new TextDecoder('latin1').decode(bytes); // archivos guardados desde Excel en ANSI
  return text.replace(/^﻿/, '');
}

const PAPA_MESSAGES = {
  MissingQuotes: 'comillas sin cerrar',
  InvalidQuotes: 'comillas mal formadas',
  UndetectableDelimiter: 'no se pudo detectar el separador',
};

export function parseCsv(bytes, Papa) {
  const text = decodeText(bytes);
  if (!text.trim()) throw badRequest('El archivo está vacío.');
  if (text.includes('\u0000')) throw badRequest('El archivo parece binario; no es un CSV de texto.');
  const res = Papa.parse(text, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  if (!res.data.length) throw badRequest('El archivo no contiene filas.');
  const [header, ...body] = res.data;
  const warnings = [];
  const relevant = res.errors.filter((e) => PAPA_MESSAGES[e.code] && !(e.code === 'UndetectableDelimiter' && header.length === 1));
  if (relevant.length) {
    warnings.push(`Problemas de formato: ${relevant.slice(0, 3).map((e) => `${PAPA_MESSAGES[e.code]}${e.row !== undefined ? ` (fila ${e.row + 2})` : ''}`).join('; ')}${relevant.length > 3 ? '…' : ''}.`);
  }
  const short = body.filter((r) => r.length < header.length).length;
  if (short) warnings.push(`${short} fila(s) tienen menos valores que encabezados; las celdas faltantes quedan vacías.`);
  if (header.length === 1 && body.length) warnings.push('Solo se detectó una columna. Si esperabas varias, revisa el separador (coma, punto y coma o tabulación).');
  return { columns: header, rows: body, warnings, meta: { delimiter: res.meta.delimiter } };
}

function flatten(obj, prefix = '', out = {}, depth = 0) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flatten(v, key, out, depth + 1);
    else out[key] = Array.isArray(v) || (v && typeof v === 'object') ? JSON.stringify(v) : v;
  }
  return out;
}

function locateArray(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    for (const k of ['data', 'rows', 'records', 'items', 'registros', 'datos']) if (Array.isArray(data[k])) return data[k];
    return Object.values(data).find(Array.isArray) || null;
  }
  return null;
}

export function parseJson(bytes) {
  const text = decodeText(bytes);
  if (!text.trim()) throw badRequest('El archivo está vacío.');
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw badRequest(`El archivo no es JSON válido: ${String(e.message).slice(0, 140)}`);
  }
  const arr = locateArray(data);
  if (!arr) throw badRequest('El JSON debe ser un arreglo de objetos, p. ej. [{"producto": "A", "ventas": 10}], o un objeto con una propiedad "data".');
  if (!arr.length) throw badRequest('El arreglo de datos está vacío.');

  const warnings = [];
  if (arr.every(Array.isArray)) return { columns: arr[0], rows: arr.slice(1), warnings: ['Se interpretó la primera fila del arreglo como encabezados.'] };

  const columns = [];
  const seen = new Set();
  const rows = [];
  let skipped = 0;
  for (const item of arr) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { skipped++; continue; }
    const flat = flatten(item);
    for (const k of Object.keys(flat)) if (!seen.has(k)) { seen.add(k); columns.push(k); }
    rows.push(flat);
  }
  if (skipped) warnings.push(`Se omitieron ${skipped} elemento(s) que no eran objetos.`);
  if (columns.some((c) => c.includes('.'))) warnings.push('Los objetos anidados se aplanaron en columnas con nombres «padre.hijo».');
  return { columns, rows, warnings };
}

function isoFromDate(d) {
  const iso = d.toISOString();
  return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? iso.slice(0, 19) : iso.slice(0, 10);
}

function cellValue(v, stats) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoFromDate(v);
  if (typeof v !== 'object') return v;
  if ('formula' in v || 'sharedFormula' in v) { stats.formulas++; return cellValue(v.result, stats); }
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return typeof v.text === 'string' ? v.text : cellValue(v.text, stats);
  if ('error' in v) { stats.errors++; return null; }
  return String(v);
}

export async function parseXlsx(bytes, ExcelJS, { sheet } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw badRequest('No se pudo leer el archivo XLSX: puede estar dañado o tener otro formato. Los archivos .xls antiguos no son compatibles; guárdalos como .xlsx o CSV.');
  }
  const sheets = wb.worksheets.map((ws) => ws.name);
  if (!sheets.length) throw badRequest('El libro no contiene hojas.');
  let ws;
  if (sheet) {
    ws = wb.getWorksheet(sheet);
    if (!ws) throw badRequest(`La hoja «${sheet}» no existe. Hojas disponibles: ${sheets.join(', ')}.`);
  } else {
    ws = wb.worksheets.find((w) => w.actualRowCount > 0) || wb.worksheets[0];
  }
  const stats = { formulas: 0, errors: 0 };
  const rows = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value, stats));
    for (let c = vals.length - 1; c >= 0; c--) if (vals[c] !== null && vals[c] !== '') { width = Math.max(width, c + 1); break; }
    rows.push(vals);
  });
  if (!rows.length) throw badRequest(`La hoja «${ws.name}» está vacía.`);
  const trimmed = rows.map((r) => r.slice(0, width));
  const warnings = [];
  if (stats.formulas) warnings.push(`${stats.formulas} celda(s) contenían fórmulas: se importó solo el valor calculado; las fórmulas no se ejecutan.`);
  if (stats.errors) warnings.push(`${stats.errors} celda(s) contenían errores de Excel (#DIV/0!, #N/A…) y quedaron vacías.`);
  if (sheets.length > 1) warnings.push(`El libro tiene ${sheets.length} hojas; se importó «${ws.name}». Puedes elegir otra hoja.`);
  return { columns: trimmed[0], rows: trimmed.slice(1), warnings, meta: { sheets, sheet: ws.name } };
}
