// Carga de conjuntos de datos de demostración (ficticios) a través del mismo flujo de importación que usa el usuario.
import path from 'node:path';
import { ROOT } from '../config.js';
import { importFromPath } from './datasets.js';
import { DEMO_DATASETS } from '../../public/js/core/demo-list.js';

export { DEMO_DATASETS };

export async function seedDemo(store) {
  const loaded = [];
  for (const d of DEMO_DATASETS) {
    if (store.findDemo(d.file)) continue;
    const ds = await importFromPath(store, path.join(ROOT, 'data', 'demo', d.file), { name: d.name, description: d.description, isDemo: true });
    loaded.push(ds.name);
  }
  store.setMeta('demo_seeded', new Date().toISOString());
  return loaded;
}
