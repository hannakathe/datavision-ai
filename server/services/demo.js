// Carga de conjuntos de datos de demostración (ficticios) a través del mismo flujo de importación que usa el usuario.
import path from 'node:path';
import { ROOT } from '../config.js';
import { importFromPath } from './datasets.js';

const NOTE = 'DATOS FICTICIOS DE DEMOSTRACIÓN generados automáticamente; no representan una empresa real.';

export const DEMO_DATASETS = [
  { file: 'ventas.csv', name: '[DEMO] Ventas 2025', description: `Ventas por fecha, región, producto, canal y vendedor. ${NOTE}` },
  { file: 'inventario.json', name: '[DEMO] Inventario de bodegas', description: `Existencias, mínimos y costos por SKU y bodega. ${NOTE}` },
  { file: 'recursos_humanos.xlsx', name: '[DEMO] Recursos humanos', description: `Planta de personal: área, cargo, salario, antigüedad y evaluación. ${NOTE}` },
  { file: 'finanzas.csv', name: '[DEMO] Presupuesto y ejecución financiera', description: `Presupuesto frente a ejecución mensual por cuenta y centro de costo. ${NOTE}` },
  { file: 'encuesta_satisfaccion.csv', name: '[DEMO] Encuesta de satisfacción (personalizado)', description: `Respuestas de una encuesta de clientes con calificación y recomendación. ${NOTE}` },
];

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
