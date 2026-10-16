import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFile } from '../server/importers/index.js';
import { buildDataset } from '../server/services/ingest.js';

const sample = (f) => fs.readFileSync(new URL(`../data/${f}`, import.meta.url));

test('CSV válido con coma', async () => {
  const p = await parseFile(sample('demo/ventas.csv'), 'ventas.csv');
  const ds = buildDataset(p);
  assert.equal(p.format, 'csv');
  assert.equal(ds.rows.length, 642);
  assert.equal(ds.schema.columns.find((c) => c.name === 'total').type, 'numerico');
  assert.equal(ds.schema.columns.find((c) => c.name === 'fecha').type, 'fecha');
});

test('CSV con punto y coma, números en formato colombiano y codificación latin1', async () => {
  const fin = buildDataset(await parseFile(sample('demo/finanzas.csv'), 'finanzas.csv'));
  assert.equal(fin.schema.columns.find((c) => c.name === 'presupuesto').type, 'numerico');
  const latin = Buffer.from('ciudad;valor\nBogotá;10\nMedellín;20\n', 'latin1');
  const ds = buildDataset(await parseFile(latin, 'l.csv'));
  assert.equal(ds.rows[0].ciudad, 'Bogotá');
});

test('JSON válido con objetos anidados', async () => {
  const p = await parseFile(sample('demo/inventario.json'), 'inventario.json');
  const ds = buildDataset(p);
  assert.ok(ds.columns.includes('proveedor.pais'));
  assert.equal(ds.schema.columns.find((c) => c.name === 'requiere_reposicion').type, 'booleano');
});

test('XLSX válido: importa valores de fórmulas sin ejecutarlas y fechas como ISO', async () => {
  const p = await parseFile(sample('demo/recursos_humanos.xlsx'), 'rh.xlsx');
  const ds = buildDataset(p);
  assert.equal(p.format, 'xlsx');
  assert.equal(ds.rows.length, 160);
  assert.ok(p.warnings.some((w) => /fórmula/.test(w)));
  assert.equal(ds.rows[0].salario_anual, ds.rows[0].salario_mensual * 12);
  assert.match(ds.rows[0].fecha_ingreso, /^\d{4}-\d{2}-\d{2}$/);
});

test('SQLite: lista tablas y lee solo tablas existentes', async () => {
  const buf = sample('samples/operaciones.sqlite');
  const p = await parseFile(buf, 'op.sqlite');
  assert.deepEqual(p.meta.tables, ['maquinas', 'produccion']);
  const prod = await parseFile(buf, 'op.sqlite', { table: 'produccion' });
  assert.equal(prod.rows.length, 180);
  await assert.rejects(parseFile(buf, 'op.sqlite', { table: 'produccion; DROP TABLE x' }), /no existe/);
  await assert.rejects(parseFile(Buffer.from('no soy sqlite'.repeat(20)), 'x.db'), /no es una base de datos SQLite/);
});

test('errores de formato, vacíos y extensiones no soportadas', async () => {
  await assert.rejects(parseFile(sample('samples/invalido.json'), 'invalido.json'), /no es JSON válido/);
  await assert.rejects(parseFile(Buffer.from(''), 'a.csv'), /vacío/);
  await assert.rejects(parseFile(Buffer.from('{"a":1}'), 'a.json'), /arreglo de objetos/);
  await assert.rejects(parseFile(Buffer.from('a'), 'a.exe'), /no soportado/);
  await assert.rejects(parseFile(Buffer.from('xx'), 'a.xlsx'), /No se pudo leer el archivo XLSX/);
  const empty = buildDataset(await parseFile(sample('samples/vacio.csv'), 'vacio.csv'));
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.validation.status, 'con_errores');
});

test('encabezados peligrosos, vacíos o repetidos se renombran', () => {
  const ds = buildDataset({ columns: ['__proto__', '', 'a', 'A', 'constructor'], rows: [[1, 2, 3, 4, 5]] });
  assert.deepEqual(ds.columns, ['__proto___col', 'columna_2', 'a', 'A_2', 'constructor_col']);
  assert.equal(Object.getPrototypeOf(ds.rows[0]), Object.prototype);
  assert.ok(ds.validation.importWarnings.some((w) => /renombraron/.test(w)));
});
