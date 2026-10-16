import { badRequest } from '../errors.js';
import { decodeText } from './csv.js';

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

export function parseJson(buffer) {
  const text = decodeText(buffer);
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
