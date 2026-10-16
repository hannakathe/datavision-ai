// Genera la versión estática para GitHub Pages en dist/ (sin servidor: los datos se guardan en el navegador).
// Uso: npm run build:pages
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../server/config.js';

const OUT = path.join(ROOT, 'dist');
const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
};

fs.rmSync(OUT, { recursive: true, force: true });
copy('public', '.');
copy('node_modules/chart.js/dist/chart.umd.min.js', 'vendor/chart.js/chart.umd.min.js');
copy('node_modules/papaparse/papaparse.min.js', 'vendor/papaparse/papaparse.min.js');
copy('node_modules/exceljs/dist/exceljs.min.js', 'vendor/exceljs/exceljs.min.js');
copy('data/demo', 'data/demo');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const files = fs.readdirSync(OUT, { recursive: true }).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
console.log(`Versión estática generada en dist/ (${files.length} archivos). Ábrela con: npm run preview:pages`);
