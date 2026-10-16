// Registro de importadores. Para añadir un conector nuevo: implementar parse(buffer|opciones) → {columns, rows, warnings, meta}
// y registrarlo aquí; el resto del flujo (normalización, esquema, validación, guardado) es común.
import path from 'node:path';
import { badRequest } from '../errors.js';
import { parseCsv } from './csv.js';
import { parseJson } from './json.js';
import { parseXlsx } from './xlsx.js';
import { parseSqliteBuffer } from './sqlite.js';

export const IMPORTERS = [
  { id: 'csv', label: 'Archivo CSV / TSV', extensions: ['.csv', '.tsv', '.txt'], status: 'disponible', parse: parseCsv },
  { id: 'json', label: 'Archivo JSON', extensions: ['.json'], status: 'disponible', parse: parseJson },
  { id: 'xlsx', label: 'Libro de Excel (.xlsx)', extensions: ['.xlsx'], status: 'disponible', parse: parseXlsx },
  { id: 'sqlite', label: 'Base de datos SQLite (archivo .db/.sqlite)', extensions: ['.db', '.sqlite', '.sqlite3'], status: 'disponible', parse: parseSqliteBuffer },
  { id: 'manual', label: 'Editor manual en la interfaz', extensions: [], status: 'disponible' },
  { id: 'cli', label: 'Consola de Node.js (npm run import)', extensions: [], status: 'disponible' },
  { id: 'rest', label: 'API REST', extensions: [], status: 'planificado' },
  { id: 'sql-server', label: 'PostgreSQL / MySQL / SQL Server', extensions: [], status: 'planificado' },
];

export const ACCEPTED_EXTENSIONS = IMPORTERS.flatMap((i) => i.extensions);

export function importerForFile(filename) {
  const ext = path.extname(String(filename || '')).toLowerCase();
  const imp = IMPORTERS.find((i) => i.parse && i.extensions.includes(ext));
  if (!imp) throw badRequest(`Formato «${ext || 'sin extensión'}» no soportado. Formatos aceptados: ${ACCEPTED_EXTENSIONS.join(', ')}.`);
  return imp;
}

export async function parseFile(buffer, filename, opts = {}) {
  if (!buffer || !buffer.length) throw badRequest('El archivo está vacío.');
  const imp = importerForFile(filename);
  const result = await imp.parse(buffer, opts);
  return { ...result, format: imp.id };
}

export function publicImporters() {
  return IMPORTERS.map(({ id, label, extensions, status }) => ({ id, label, extensions, status }));
}
