import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitValues, manualDataset, applyColumnTypes, cleanedDataset } from '../public/js/core/manage.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('consola de datos: separa valores con comillas, punto y coma y tabulaciones', () => {
  assert.deepEqual(splitValues('Lápiz, Papelería, 10'), ['Lápiz', 'Papelería', '10']);
  assert.deepEqual(splitValues('"Rojo, grande", 5'), ['Rojo, grande', '5']);
  assert.deepEqual(splitValues('a;1,5;x'), ['a', '1,5', 'x']);
  assert.deepEqual(splitValues('a\tb'), ['a', 'b']);
  assert.deepEqual(splitValues('"dice ""hola""", 2'), ['dice "hola"', '2']);
});

test('reglas de gestión compartidas (usadas por el modo navegador)', () => {
  const ds = manualDataset({ columns: ['p', 'n'], rows: [['a', '1'], ['b', ''], ['a', '1']] });
  assert.equal(ds.rows.length, 3);
  assert.throws(() => manualDataset({ columns: ['p', 'P'], rows: [['a', 'b']] }), /repetidos/);
  const schema = applyColumnTypes(ds.schema, { n: 'categoria' });
  assert.equal(schema.columns[1].type, 'categoria');
  assert.equal(ds.schema.columns[1].type, 'numerico', 'no muta el esquema original');
  const { ds: clean, report } = cleanedDataset({ ...ds, schema }, ds.rows, { removeDuplicates: true });
  assert.equal(clean.rows.length, 2);
  assert.equal(clean.schema.columns[1].type, 'categoria');
  assert.ok(report.length);
});

test('build:pages genera una versión estática completa con rutas relativas', () => {
  const r = spawnSync(process.execPath, ['--no-warnings', 'scripts/build-pages.js'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const dist = path.join(root, 'dist');
  for (const f of ['index.html', 'js/app.js', 'js/local-api.js', 'vendor/chart.js/chart.umd.min.js', 'vendor/papaparse/papaparse.min.js', 'vendor/exceljs/exceljs.min.js', 'data/demo/ventas.csv', 'data/demo/recursos_humanos.xlsx', '.nojekyll']) {
    assert.ok(fs.existsSync(path.join(dist, f)), `falta ${f}`);
  }
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(src|href)="\//, 'no debe haber rutas absolutas (fallan en un subdirectorio de Pages)');
});
