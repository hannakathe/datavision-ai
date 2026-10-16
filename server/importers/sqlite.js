// Conector SQLite de solo lectura: lista tablas/vistas y lee una tabla elegida de una lista blanca (sin SQL libre).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { badRequest } from '../errors.js';
import { config } from '../config.js';

const MAGIC = 'SQLite format 3\u0000';

const quoteIdent = (name) => `"${String(name).replaceAll('"', '""')}"`;

function plain(v) {
  if (v instanceof Uint8Array) return '[binario]';
  if (typeof v === 'bigint') return Number(v);
  return v;
}

export function readSqliteFile(file, { table } = {}) {
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw badRequest('No se pudo abrir la base de datos SQLite.');
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
    if (!tables.length) throw badRequest('La base de datos no contiene tablas.');
    const chosen = table || tables[0];
    if (!tables.includes(chosen)) throw badRequest(`La tabla «${chosen}» no existe. Tablas disponibles: ${tables.join(', ')}.`);
    const q = quoteIdent(chosen);
    const columns = db.prepare(`PRAGMA table_info(${q})`).all().map((c) => c.name);
    const rows = db.prepare(`SELECT * FROM ${q} LIMIT ?`).all(config.maxRows + 1)
      .map((r) => Object.fromEntries(columns.map((c) => [c, plain(r[c])])));
    const warnings = tables.length > 1 ? [`La base tiene ${tables.length} tablas/vistas; se leyó «${chosen}». Puedes elegir otra.`] : [];
    return { columns, rows, warnings, meta: { tables, table: chosen } };
  } catch (e) {
    if (e.expose) throw e;
    throw badRequest('No se pudo leer la base de datos SQLite (archivo dañado o cifrado).');
  } finally {
    db.close();
  }
}

export function parseSqliteBuffer(buffer, opts = {}) {
  if (buffer.length < 100 || buffer.subarray(0, 16).toString('latin1') !== MAGIC) {
    throw badRequest('El archivo no es una base de datos SQLite válida.');
  }
  const tmp = path.join(os.tmpdir(), `datavision-${crypto.randomUUID()}.sqlite`);
  fs.writeFileSync(tmp, buffer);
  try {
    return readSqliteFile(tmp, opts);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
