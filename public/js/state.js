// Estado de la sesión del navegador: caché de conjuntos cargados y configuración de dashboard en curso.
import { api } from './api.js';
import { prepare } from './core/data.js';
import { storageGet, storageSet } from './ui.js';

const cache = new Map();
export const dashboards = new Map(); // datasetId → { config, tab, savedId, savedName, drill }

export async function loadDataset(id) {
  id = Number(id);
  if (cache.has(id)) return cache.get(id);
  const [meta, data] = await Promise.all([api.dataset(id), api.rows(id)]);
  const entry = { meta, prep: prepare(data.rows, meta.schema) };
  cache.set(id, entry);
  return entry;
}

export function invalidate(id) {
  cache.delete(Number(id));
  dashboards.delete(Number(id));
}

export function lastDatasetId() {
  return Number(storageGet('dv:last')) || null;
}

export function setLastDataset(id) {
  storageSet('dv:last', String(id));
}
