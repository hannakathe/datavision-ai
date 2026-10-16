// Conjuntos de demostración (ficticios) que se cargan en el primer uso, en el servidor o en el navegador.
const NOTE = 'DATOS FICTICIOS DE DEMOSTRACIÓN generados automáticamente; no representan una empresa real.';

export const DEMO_DATASETS = [
  { file: 'ventas.csv', name: '[DEMO] Ventas 2025', description: `Ventas por fecha, región, producto, canal y vendedor. ${NOTE}` },
  { file: 'inventario.json', name: '[DEMO] Inventario de bodegas', description: `Existencias, mínimos y costos por SKU y bodega. ${NOTE}` },
  { file: 'recursos_humanos.xlsx', name: '[DEMO] Recursos humanos', description: `Planta de personal: área, cargo, salario, antigüedad y evaluación. ${NOTE}` },
  { file: 'finanzas.csv', name: '[DEMO] Presupuesto y ejecución financiera', description: `Presupuesto frente a ejecución mensual por cuenta y centro de costo. ${NOTE}` },
  { file: 'encuesta_satisfaccion.csv', name: '[DEMO] Encuesta de satisfacción (personalizado)', description: `Respuestas de una encuesta de clientes con calificación y recomendación. ${NOTE}` },
];
