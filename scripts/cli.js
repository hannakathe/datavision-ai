#!/usr/bin/env node
// Consola de DataVision AI: importar, listar y eliminar conjuntos de datos directamente en la base SQLite local.
import path from 'node:path';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { dbFile } from '../server/config.js';
import { Store } from '../server/db.js';
import { importFromPath } from '../server/services/datasets.js';
import { seedDemo } from '../server/services/demo.js';
import { STATUS_LABELS } from '../public/js/core/quality.js';

const HELP = `DataVision AI · consola

Uso:
  npm run import -- <archivo> [--name "Nombre"] [--description "Texto"] [--sheet Hoja] [--table tabla]
  npm run cli -- list
  npm run cli -- delete <id>
  npm run seed

Formatos: .csv .tsv .txt .json .xlsx .db .sqlite .sqlite3
  --sheet  hoja de Excel a importar (por defecto la primera con datos)
  --table  tabla o vista de un archivo SQLite (por defecto la primera)`;

const [command, ...rest] = process.argv.slice(2);
let store;

try {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { name: { type: 'string' }, description: { type: 'string' }, sheet: { type: 'string' }, table: { type: 'string' } },
  });
  store = new Store(dbFile());

  switch (command) {
    case 'import': {
      const file = positionals[0];
      if (!file) throw new Error('Indica la ruta del archivo a importar.');
      const abs = path.resolve(file);
      if (!fs.existsSync(abs)) throw new Error(`No se encontró el archivo: ${abs}`);
      const ds = await importFromPath(store, abs, { name: values.name, description: values.description || '', sheet: values.sheet, table: values.table, sourceType: undefined });
      console.log(`✔ Importación completada: #${ds.id} «${ds.name}»`);
      console.log(`  ${ds.rowCount} filas · ${ds.columnCount} columnas · estado: ${STATUS_LABELS[ds.status]}`);
      console.log(`  Columnas: ${ds.schema.columns.map((c) => `${c.name} (${c.type})`).join(', ')}`);
      for (const w of ds.validation.importWarnings || []) console.log(`  ⚠ ${w}`);
      for (const i of ds.validation.issues.filter((x) => x.level !== 'info').slice(0, 8)) console.log(`  ⚠ ${i.message}`);
      break;
    }
    case 'list': {
      const list = store.listDatasets();
      if (!list.length) console.log('No hay conjuntos de datos.');
      for (const d of list) console.log(`#${d.id}\t${d.name}\t${d.rowCount} filas × ${d.columnCount} col.\t${d.sourceType}\t${STATUS_LABELS[d.status]}`);
      break;
    }
    case 'delete': {
      const id = Number(positionals[0]);
      if (!Number.isInteger(id)) throw new Error('Indica el id numérico del conjunto a eliminar.');
      if (!store.deleteDataset(id)) throw new Error(`No existe el conjunto #${id}.`);
      console.log(`✔ Conjunto #${id} eliminado.`);
      break;
    }
    case 'seed': {
      const loaded = await seedDemo(store);
      console.log(loaded.length ? `✔ Cargados: ${loaded.join(', ')}` : 'Los datos de demostración ya estaban cargados.');
      break;
    }
    default:
      console.log(HELP);
      if (command && command !== 'help') process.exitCode = 1;
  }
} catch (e) {
  console.error(`✖ La operación falló: ${e.message}`);
  process.exitCode = 1;
} finally {
  store?.close();
}
