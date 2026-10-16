// Sirve dist/ como lo haría GitHub Pages (solo archivos estáticos, bajo un subdirectorio) para probarlo en local.
import path from 'node:path';
import express from 'express';
import { ROOT } from '../server/config.js';

const port = Number(process.env.PORT) || 4173;
const app = express();
app.use('/datavision-ai', express.static(path.join(ROOT, 'dist')));
app.get('/', (req, res) => res.redirect('/datavision-ai/'));
app.listen(port, '127.0.0.1', () => console.log(`Vista previa estática en http://localhost:${port}/datavision-ai/`));
