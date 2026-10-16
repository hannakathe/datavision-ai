// Persistencia local con SQLite (módulo integrado node:sqlite). Todas las consultas usan sentencias preparadas.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL,
  source_detail TEXT NOT NULL DEFAULT '',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  column_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dataset_rows (
  dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (dataset_id, row_index)
);
CREATE TABLE IF NOT EXISTS dashboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset_id INTEGER NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  config_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const now = () => new Date().toISOString();

function datasetFromRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sourceType: r.source_type,
    sourceDetail: r.source_detail,
    isDemo: !!r.is_demo,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    rowCount: r.row_count,
    columnCount: r.column_count,
    columns: JSON.parse(r.columns_json),
    schema: JSON.parse(r.schema_json),
    validation: JSON.parse(r.validation_json),
    status: r.status,
  };
}

function dashboardFromRow(r) {
  if (!r) return null;
  return { id: r.id, datasetId: r.dataset_id, name: r.name, config: JSON.parse(r.config_json), createdAt: r.created_at, updatedAt: r.updated_at };
}

export class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  tx(fn) {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  listDatasets() {
    return this.db.prepare('SELECT * FROM datasets ORDER BY is_demo ASC, updated_at DESC').all().map((r) => {
      const d = datasetFromRow(r);
      delete d.validation.byColumn;
      return d;
    });
  }

  getDataset(id) {
    return datasetFromRow(this.db.prepare('SELECT * FROM datasets WHERE id = ?').get(Number(id)));
  }

  getRows(id, offset = 0, limit = -1) {
    return this.db.prepare('SELECT data_json FROM dataset_rows WHERE dataset_id = ? ORDER BY row_index LIMIT ? OFFSET ?')
      .all(Number(id), limit, offset).map((r) => JSON.parse(r.data_json));
  }

  #insertRows(id, rows) {
    const stmt = this.db.prepare('INSERT INTO dataset_rows (dataset_id, row_index, data_json) VALUES (?, ?, ?)');
    rows.forEach((row, i) => stmt.run(id, i, JSON.stringify(row)));
  }

  createDataset({ name, description = '', sourceType, sourceDetail = '', isDemo = false, columns, rows, schema, validation }) {
    return this.tx(() => {
      const t = now();
      const info = this.db.prepare(`INSERT INTO datasets (name, description, source_type, source_detail, is_demo, created_at, updated_at,
        row_count, column_count, columns_json, schema_json, validation_json, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(name, description, sourceType, sourceDetail, isDemo ? 1 : 0, t, t, rows.length, columns.length,
          JSON.stringify(columns), JSON.stringify(schema), JSON.stringify(validation), validation.status);
      const id = Number(info.lastInsertRowid);
      this.#insertRows(id, rows);
      return id;
    });
  }

  replaceData(id, { columns, rows, schema, validation }) {
    this.tx(() => {
      this.db.prepare('DELETE FROM dataset_rows WHERE dataset_id = ?').run(Number(id));
      this.#insertRows(Number(id), rows);
      this.db.prepare(`UPDATE datasets SET row_count=?, column_count=?, columns_json=?, schema_json=?, validation_json=?, status=?, updated_at=? WHERE id=?`)
        .run(rows.length, columns.length, JSON.stringify(columns), JSON.stringify(schema), JSON.stringify(validation), validation.status, now(), Number(id));
    });
  }

  updateSchema(id, schema, validation) {
    this.db.prepare('UPDATE datasets SET schema_json=?, validation_json=?, status=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(schema), JSON.stringify(validation), validation.status, now(), Number(id));
  }

  updateMeta(id, { name, description }) {
    const d = this.getDataset(id);
    if (!d) return false;
    this.db.prepare('UPDATE datasets SET name=?, description=?, updated_at=? WHERE id=?')
      .run(name ?? d.name, description ?? d.description, now(), Number(id));
    return true;
  }

  deleteDataset(id) {
    return this.db.prepare('DELETE FROM datasets WHERE id = ?').run(Number(id)).changes > 0;
  }

  findDemo(sourceDetail) {
    return this.db.prepare('SELECT id FROM datasets WHERE is_demo = 1 AND source_detail = ?').get(sourceDetail);
  }

  listDashboards(datasetId) {
    return this.db.prepare('SELECT * FROM dashboards WHERE dataset_id = ? ORDER BY updated_at DESC').all(Number(datasetId)).map(dashboardFromRow);
  }

  getDashboard(id) {
    return dashboardFromRow(this.db.prepare('SELECT * FROM dashboards WHERE id = ?').get(Number(id)));
  }

  createDashboard(datasetId, name, config) {
    const t = now();
    const info = this.db.prepare('INSERT INTO dashboards (dataset_id, name, config_json, created_at, updated_at) VALUES (?,?,?,?,?)')
      .run(Number(datasetId), name, JSON.stringify(config), t, t);
    return Number(info.lastInsertRowid);
  }

  updateDashboard(id, { name, config }) {
    const d = this.getDashboard(id);
    if (!d) return false;
    this.db.prepare('UPDATE dashboards SET name=?, config_json=?, updated_at=? WHERE id=?')
      .run(name ?? d.name, JSON.stringify(config ?? d.config), now(), Number(id));
    return true;
  }

  deleteDashboard(id) {
    return this.db.prepare('DELETE FROM dashboards WHERE id = ?').run(Number(id)).changes > 0;
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }
}
