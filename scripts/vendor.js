// Copia las librerías del navegador desde node_modules a vendor/ (carpeta versionada).
// Así GitHub Pages puede servirlas directamente desde la rama, sin paso de compilación.
// Uso: npm run vendor (después de actualizar chart.js, papaparse o exceljs).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

export const VENDOR_FILES = {
  'chart.js/chart.umd.min.js': 'node_modules/chart.js/dist/chart.umd.min.js',
  'papaparse/papaparse.min.js': 'node_modules/papaparse/papaparse.min.js',
  'exceljs/exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js',
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(ROOT, 'scripts', 'vendor.js')) {
  for (const [to, from] of Object.entries(VENDOR_FILES)) {
    const dest = path.join(ROOT, 'vendor', to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, from), dest);
    console.log(`vendor/${to}`);
  }
}
