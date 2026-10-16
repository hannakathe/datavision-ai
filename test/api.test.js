// Pruebas de las rutas HTTP y de la persistencia SQLite usando un directorio temporal.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-api-'));
process.env.DATA_DIR = dir;
process.env.MAX_UPLOAD_MB = '1';

const { Store } = await import('../server/db.js');
const { createApp } = await import('../server/app.js');
const { dbFile } = await import('../server/config.js');

let store;
let server;
let base;

before(async () => {
  store = new Store(dbFile());
  server = createApp(store).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const json = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

async function upload(file, name = path.basename(file), extra = {}) {
  const form = new FormData();
  form.append('archivo', new Blob([fs.readFileSync(new URL(`../data/${file}`, import.meta.url))]), name);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  const res = await fetch(`${base}/import/preview`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

async function importAndCommit(file, name) {
  const p = await upload(file);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const c = await json('POST', '/import/commit', { uploadId: p.body.uploadId, name });
  assert.equal(c.status, 201);
  return c.body;
}

test('rutas principales: salud, importadores y estático', async () => {
  assert.equal((await json('GET', '/health')).body.ok, true);
  const imp = (await json('GET', '/importers')).body;
  assert.ok(imp.importers.find((i) => i.id === 'rest').status === 'planificado');
  const html = await fetch(base.replace('/api', '/'));
  assert.match(await html.text(), /DataVision AI/);
  assert.equal((await fetch(base.replace('/api', '/vendor/chart.js/chart.umd.min.js'))).status, 200);
  assert.equal((await json('GET', '/no-existe')).status, 404);
  assert.equal(html.headers.get('x-content-type-options'), 'nosniff');
});

test('importación CSV, JSON y XLSX con vista previa y confirmación', async () => {
  const csv = await importAndCommit('demo/ventas.csv', 'Ventas');
  const js = await importAndCommit('demo/inventario.json', 'Inventario');
  const xl = await importAndCommit('demo/recursos_humanos.xlsx', 'RRHH');
  assert.equal(csv.rowCount, 642);
  assert.equal(js.sourceType, 'json');
  assert.equal(xl.rowCount, 160);
  assert.notDeepEqual(csv.columns, xl.columns, 'los conjuntos tienen columnas distintas');
  const p = await upload('samples/operaciones.sqlite', 'op.sqlite', { table: 'maquinas' });
  assert.equal(p.body.meta.table, 'maquinas');
  assert.equal(p.body.rowCount, 12);
});

test('vista previa informa errores de calidad y rechaza archivos inválidos', async () => {
  const p = await upload('samples/con_errores.csv');
  assert.equal(p.body.validation.status, 'con_advertencias');
  assert.equal(p.body.validation.duplicateCount, 1);
  assert.equal(p.body.previewRows.length, 9);
  assert.equal((await upload('samples/invalido.json')).status, 400);
  const empty = await upload('samples/vacio.csv');
  const c = await json('POST', '/import/commit', { uploadId: empty.body.uploadId, name: 'Vacío' });
  assert.equal(c.status, 400);
  assert.equal((await json('POST', '/import/commit', { uploadId: 'falso', name: 'x' })).status, 400);
  const big = new FormData();
  big.append('archivo', new Blob([Buffer.alloc(1.2 * 1024 * 1024, 'a')]), 'grande.csv');
  const r = await fetch(`${base}/import/preview`, { method: 'POST', body: big });
  assert.equal(r.status, 413);
});

test('entrada manual: validación y creación', async () => {
  assert.equal((await json('POST', '/datasets', { name: 'x', columns: ['a', 'a'], rows: [[1, 2]] })).status, 400);
  assert.equal((await json('POST', '/datasets', { name: 'x', columns: ['a'], rows: [['']] })).status, 400);
  assert.equal((await json('POST', '/datasets', { name: '', columns: ['a'], rows: [['1']] })).status, 400);
  const r = await json('POST', '/datasets', { name: 'Manual', description: 'prueba', columns: ['producto', 'cantidad', 'fecha'], rows: [['A', '3', '2025-01-01'], ['B', '5', '2025-01-02'], ['C', '', '2025-01-03']] });
  assert.equal(r.status, 201);
  assert.equal(r.body.sourceType, 'manual');
  assert.equal(r.body.schema.columns.find((c) => c.name === 'cantidad').type, 'numerico');
  const upd = await json('PUT', `/datasets/${r.body.id}/rows`, { name: 'Manual 2', columns: ['producto', 'cantidad'], rows: [['A', '1']] });
  assert.equal(upd.body.rowCount, 1);
  assert.equal(upd.body.name, 'Manual 2');
});

test('gestión: listar, renombrar, cambiar tipo, consultar, limpiar, exportar y eliminar', async () => {
  const d = await importAndCommit('samples/con_errores.csv', 'Errores');
  const ren = await json('PATCH', `/datasets/${d.id}`, { name: 'Errores renombrado', description: 'desc' });
  assert.equal(ren.body.name, 'Errores renombrado');
  const typed = await json('PATCH', `/datasets/${d.id}`, { columnTypes: { cantidad: 'categoria' } });
  assert.equal(typed.body.schema.columns.find((c) => c.name === 'cantidad').type, 'categoria');
  assert.equal((await json('PATCH', `/datasets/${d.id}`, { columnTypes: { cantidad: 'codigo' } })).status, 400);

  const q = await json('POST', `/datasets/${d.id}/query`, { filters: [{ column: 'activo', op: 'in', values: ['Sí'] }], sort: { column: 'precio', dir: 'desc' }, limit: 2 });
  assert.equal(q.body.total, 5);
  assert.equal(q.body.rows.length, 2);
  assert.equal(q.body.rows[0].producto, 'Tijeras');
  assert.equal((await json('POST', `/datasets/${d.id}/query`, { sort: { column: 'x; DROP TABLE datasets' } })).status, 400);

  const cl = await json('POST', `/datasets/${d.id}/clean`, { removeDuplicates: true, missing: [{ column: 'activo', strategy: 'fill_value', value: 'no' }] });
  assert.equal(cl.status, 201);
  assert.notEqual(cl.body.dataset.id, d.id, 'por defecto crea una copia');
  assert.equal(cl.body.dataset.rowCount, 8);
  assert.equal(cl.body.dataset.schema.columns.find((c) => c.name === 'cantidad').type, 'categoria', 'conserva tipos cambiados');
  assert.equal((await json('GET', `/datasets/${d.id}`)).body.rowCount, 9, 'el original no cambia');
  assert.equal((await json('POST', `/datasets/${d.id}/clean`, {})).status, 400);

  const exp = await fetch(`${base}/datasets/${d.id}/export.csv`);
  const text = await exp.text();
  assert.match(text, /"?'=HYPERLINK/, 'las fórmulas se neutralizan al exportar');

  assert.ok((await json('GET', '/datasets')).body.some((x) => x.id === d.id));
  assert.equal((await json('DELETE', `/datasets/${d.id}`)).status, 204);
  assert.equal((await json('GET', `/datasets/${d.id}`)).status, 404);
  assert.equal((await json('GET', '/datasets/abc')).status, 400);
});

test('configuraciones de dashboard: guardar, recuperar, actualizar y eliminar', async () => {
  const d = await importAndCommit('demo/finanzas.csv', 'Finanzas');
  const config = { kpis: [{ id: 'k1', op: 'sum', column: 'ejecutado' }], charts: [{ id: 'g1', page: 'resumen', type: 'line', x: 'mes', y: 'ejecutado', op: 'sum' }, { id: 'g2', type: 'bar', x: 'inexistente' }], filters: [{ column: 'tipo', op: 'in', values: ['Gasto'] }] };
  assert.equal((await json('POST', `/datasets/${d.id}/dashboards`, { name: '', config })).status, 400);
  const s = await json('POST', `/datasets/${d.id}/dashboards`, { name: 'Ejecución', config });
  assert.equal(s.status, 201);
  assert.equal(s.body.config.charts.length, 1, 'se descarta la gráfica con columna inexistente');
  const got = await json('GET', `/dashboards/${s.body.id}`);
  assert.deepEqual(got.body.config.filters[0].values, ['Gasto']);
  const upd = await json('PUT', `/dashboards/${s.body.id}`, { name: 'Ejecución v2', config: { ...config, charts: [] } });
  assert.equal(upd.body.name, 'Ejecución v2');
  assert.equal(upd.body.config.charts.length, 0);
  assert.equal((await json('GET', `/datasets/${d.id}/dashboards`)).body.length, 1);
  assert.equal((await json('DELETE', `/dashboards/${s.body.id}`)).status, 204);
  assert.equal((await json('GET', `/dashboards/${s.body.id}`)).status, 404);
});

test('persistencia: los datos sobreviven al cerrar y reabrir la base SQLite', async () => {
  const d = await importAndCommit('demo/encuesta_satisfaccion.csv', 'Encuesta');
  await json('POST', `/datasets/${d.id}/dashboards`, { name: 'Persistente', config: { charts: [], kpis: [], filters: [] } });
  const reopened = new Store(dbFile());
  try {
    const again = reopened.getDataset(d.id);
    assert.equal(again.name, 'Encuesta');
    assert.equal(reopened.getRows(d.id).length, 320);
    assert.equal(reopened.listDashboards(d.id)[0].name, 'Persistente');
  } finally {
    reopened.close();
  }
});

test('eliminar un conjunto elimina en cascada filas y dashboards', async () => {
  const d = await importAndCommit('samples/con_errores.csv', 'Cascada');
  await json('POST', `/datasets/${d.id}/dashboards`, { name: 'x', config: {} });
  await json('DELETE', `/datasets/${d.id}`);
  assert.equal(store.getRows(d.id).length, 0);
  assert.equal(store.listDashboards(d.id).length, 0);
});

test('datos de demostración se cargan una sola vez', async () => {
  const a = await json('POST', '/demo/load');
  assert.equal(a.body.loaded.length, 5);
  const b = await json('POST', '/demo/load');
  assert.equal(b.body.loaded.length, 0);
  const list = (await json('GET', '/datasets')).body.filter((x) => x.isDemo);
  assert.equal(list.length, 5);
  assert.ok(list.every((x) => /FICTICIOS/.test(x.description)));
});
