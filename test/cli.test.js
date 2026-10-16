import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dv-cli-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (...args) => spawnSync(process.execPath, ['--no-warnings', 'scripts/cli.js', ...args], { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });

test('la consola importa CSV, JSON y SQLite e informa el resultado', () => {
  const a = run('import', 'data/demo/ventas.csv', '--name', 'Ventas CLI');
  assert.equal(a.status, 0, a.stderr);
  assert.match(a.stdout, /Importación completada: #1 «Ventas CLI»/);
  assert.match(a.stdout, /642 filas/);
  const b = run('import', 'data/samples/proyectos.json');
  assert.equal(b.status, 0, b.stderr);
  const c = run('import', 'data/samples/operaciones.sqlite', '--table', 'maquinas');
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /12 filas/);
  const list = run('list');
  assert.match(list.stdout, /Ventas CLI/);
  assert.match(list.stdout, /proyectos/);
});

test('la consola explica los fallos con código de salida distinto de cero', () => {
  const missing = run('import', 'no/existe.csv');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No se encontró el archivo/);
  const invalid = run('import', 'data/samples/invalido.json');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /no es JSON válido/);
  const empty = run('import', 'data/samples/vacio.csv');
  assert.equal(empty.status, 1);
  const del = run('delete', '999');
  assert.equal(del.status, 1);
  assert.equal(run('delete', '1').status, 0);
});
