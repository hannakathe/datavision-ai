// Copia en dist/ solo los archivos que necesita la versión estática, para probarla con npm run preview:pages
// (o publicarla con el workflow manual). GitHub Pages también puede servir directamente la raíz del repositorio.
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
// Misma estructura que la raíz del repositorio (la que GitHub Pages sirve con «Deploy from a branch → / (root)»).
copy('index.html', 'index.html');
copy('public', 'public');
copy('vendor', 'vendor');
copy('data/demo', 'data/demo');
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const files = fs.readdirSync(OUT, { recursive: true }).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
console.log(`Versión estática generada en dist/ (${files.length} archivos). Ábrela con: npm run preview:pages`);
