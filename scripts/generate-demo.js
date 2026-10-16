// Genera de forma determinista los conjuntos de datos FICTICIOS de demostración y las muestras de prueba.
// Uso: npm run demo:generate
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { ROOT } from '../server/config.js';

const DEMO = path.join(ROOT, 'data', 'demo');
const SAMPLES = path.join(ROOT, 'data', 'samples');
fs.mkdirSync(DEMO, { recursive: true });
fs.mkdirSync(SAMPLES, { recursive: true });

let seed = 20251016;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const weighted = (pairs) => { const total = pairs.reduce((a, [, w]) => a + w, 0); let x = rnd() * total; for (const [v, w] of pairs) { x -= w; if (x <= 0) return v; } return pairs[0][0]; };
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (base, n) => new Date(base.getTime() + n * 864e5);
const writeCsv = (file, rows, opts = {}) => fs.writeFileSync(file, Papa.unparse(rows, opts), 'utf8');

// ---------- Ventas ----------
const catalog = {
  Tecnología: [['Portátil', 2800000], ['Monitor', 750000], ['Teclado', 120000], ['Audífonos', 210000]],
  Hogar: [['Licuadora', 260000], ['Cafetera', 340000], ['Aspiradora', 520000]],
  Papelería: [['Resma de papel', 22000], ['Kit de esferos', 15000], ['Agenda', 38000]],
  Deportes: [['Bicicleta estática', 1250000], ['Balón', 85000], ['Mancuernas', 140000]],
};
const ventas = [];
const start = new Date(Date.UTC(2025, 0, 1));
for (let i = 0; i < 640; i++) {
  const day = int(0, 364);
  const fecha = addDays(start, day);
  const categoria = weighted([['Tecnología', 4], ['Hogar', 3], ['Papelería', 2], ['Deportes', 2]]);
  const [producto, precio] = pick(catalog[categoria]);
  const growth = 1 + day / 365 * 0.6 + (fecha.getUTCMonth() === 11 ? 0.5 : 0);
  const unidades = Math.max(1, Math.round(int(1, 18) * growth));
  const descuento = weighted([[0, 6], [5, 3], [10, 2], [15, 1]]);
  ventas.push({
    id_venta: `V-${String(i + 1).padStart(4, '0')}`,
    fecha: iso(fecha),
    region: weighted([['Andina', 5], ['Caribe', 3], ['Pacífica', 2], ['Orinoquía', 1], ['Amazonía', 0.5]]),
    canal: i % 97 === 5 ? '' : weighted([['Tienda física', 4], ['En línea', 3], ['Distribuidor', 2]]),
    categoria,
    producto,
    vendedor: `Asesor ${String(int(1, 8)).padStart(2, '0')}`,
    unidades,
    precio_unitario: precio,
    descuento_pct: descuento,
    total: Math.round(unidades * precio * (1 - descuento / 100)),
  });
}
ventas.sort((a, b) => a.fecha.localeCompare(b.fecha));
ventas.push({ ...ventas[10] }, { ...ventas[200] }); // duplicados intencionales para demostrar el diagnóstico
writeCsv(path.join(DEMO, 'ventas.csv'), ventas);

// ---------- Inventario (JSON con objetos anidados) ----------
const bodegas = ['Bogotá', 'Medellín', 'Cali', 'Barranquilla'];
const proveedores = [['Suministros Andinos', 'Colombia'], ['TecnoImport', 'China'], ['Distribuciones del Norte', 'México'], ['Global Parts', 'Estados Unidos']];
const inventario = [];
let sku = 1000;
for (const [categoria, items] of Object.entries(catalog)) {
  for (const [producto, precio] of items) {
    for (const bodega of bodegas) {
      const minimo = int(10, 40);
      const stock = rnd() < 0.2 ? int(0, minimo - 1) : int(minimo, minimo * 6);
      const [nombre, pais] = pick(proveedores);
      inventario.push({
        sku: `SKU-${++sku}`,
        producto,
        categoria,
        bodega,
        stock,
        stock_minimo: minimo,
        costo_unitario: Math.round(precio * (0.55 + rnd() * 0.15)),
        ultima_entrada: iso(addDays(start, int(150, 290))),
        requiere_reposicion: stock < minimo,
        proveedor: { nombre, pais },
      });
    }
  }
}
fs.writeFileSync(path.join(DEMO, 'inventario.json'), JSON.stringify({ generado: 'Datos ficticios de demostración', data: inventario }, null, 2));

// ---------- Recursos humanos (XLSX con fórmula) ----------
const areas = { Comercial: ['Asesor comercial', 'Coordinador comercial'], Tecnología: ['Desarrollador', 'Analista de datos', 'Líder técnico'], Operaciones: ['Auxiliar logístico', 'Jefe de bodega'], Finanzas: ['Analista financiero', 'Contador'], 'Talento humano': ['Analista de nómina', 'Psicólogo organizacional'] };
const salarioBase = { 'Asesor comercial': 2.1, 'Coordinador comercial': 4.2, Desarrollador: 5.5, 'Analista de datos': 5.0, 'Líder técnico': 9.0, 'Auxiliar logístico': 1.8, 'Jefe de bodega': 3.6, 'Analista financiero': 4.4, Contador: 5.2, 'Analista de nómina': 3.2, 'Psicólogo organizacional': 3.9 };
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet('Empleados');
ws.addRow(['id_empleado', 'area', 'cargo', 'sede', 'modalidad', 'fecha_ingreso', 'salario_mensual', 'salario_anual', 'edad', 'evaluacion_desempeno', 'horas_capacitacion', 'activo']);
for (let i = 1; i <= 160; i++) {
  const area = weighted([['Comercial', 4], ['Tecnología', 3], ['Operaciones', 3], ['Finanzas', 1.5], ['Talento humano', 1]]);
  const cargo = pick(areas[area]);
  const ingreso = new Date(Date.UTC(int(2012, 2025), int(0, 11), int(1, 28)));
  const antig = 2025 - ingreso.getUTCFullYear();
  const salario = Math.round((salarioBase[cargo] * (1 + antig * 0.025) * (0.92 + rnd() * 0.16)) * 1e6 / 1000) * 1000;
  const capacitacion = int(0, 80);
  const r = ws.addRow([
    `E-${String(i).padStart(3, '0')}`, area, cargo, pick(['Bogotá', 'Medellín', 'Cali']), weighted([['Presencial', 3], ['Híbrido', 4], ['Remoto', 2]]),
    ingreso, salario, null, int(20, 62), i % 41 === 0 ? null : round(Math.min(5, 2.6 + capacitacion / 50 + rnd() * 1.4), 1), capacitacion, rnd() < 0.93 ? 'Sí' : 'No',
  ]);
  r.getCell(8).value = { formula: `G${r.number}*12`, result: salario * 12 };
}
ws.getColumn(6).numFmt = 'yyyy-mm-dd';
await wb.xlsx.writeFile(path.join(DEMO, 'recursos_humanos.xlsx'));

// ---------- Finanzas (CSV con ; y números en formato colombiano) ----------
const cuentas = [['Ingresos por ventas', 'Ingreso', 'Comercial', 420e6], ['Nómina', 'Gasto', 'Administración', 180e6], ['Arriendo', 'Gasto', 'Administración', 32e6], ['Marketing digital', 'Gasto', 'Comercial', 28e6], ['Tecnología', 'Gasto', 'Operaciones', 22e6], ['Servicios públicos', 'Gasto', 'Operaciones', 9e6], ['Transporte', 'Gasto', 'Operaciones', 15e6]];
const fmtCo = (v) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const finanzas = [];
for (let m = 0; m < 24; m++) {
  const y = 2024 + Math.floor(m / 12);
  const mes = `${y}-${String((m % 12) + 1).padStart(2, '0')}`;
  for (const [cuenta, tipo, centro, base] of cuentas) {
    const presupuesto = base * (1 + m * 0.012);
    const ejecutado = presupuesto * (tipo === 'Ingreso' ? 0.85 + rnd() * 0.3 : 0.8 + rnd() * 0.35);
    finanzas.push({ mes, cuenta, tipo, centro_costo: centro, presupuesto: fmtCo(presupuesto), ejecutado: fmtCo(ejecutado) });
  }
}
writeCsv(path.join(DEMO, 'finanzas.csv'), finanzas, { delimiter: ';' });

// ---------- Encuesta (conjunto personalizado) ----------
const comentarios = ['', '', 'Buena atención', 'Demora en la respuesta', 'Excelente servicio', 'El producto llegó tarde', 'Volvería a comprar', ''];
const encuesta = [];
for (let i = 0; i < 320; i++) {
  const espera = int(1, 45);
  const calif = Math.max(1, Math.min(5, Math.round(5.2 - espera / 14 + (rnd() - 0.5) * 1.6)));
  encuesta.push({
    fecha_respuesta: iso(addDays(new Date(Date.UTC(2025, 2, 1)), int(0, 200))),
    ciudad: weighted([['Bogotá', 5], ['Medellín', 3], ['Cali', 2], ['Bucaramanga', 1], ['Pereira', 1]]),
    canal_atencion: pick(['Chat', 'Teléfono', 'Correo', 'Presencial']),
    edad: i % 53 === 0 ? '' : int(18, 75),
    tiempo_espera_min: espera,
    calificacion: calif,
    recomendaria: calif >= 4 ? (rnd() < 0.9 ? 'Sí' : 'No') : rnd() < 0.2 ? 'Sí' : 'No',
    comentario: pick(comentarios),
  });
}
writeCsv(path.join(DEMO, 'encuesta_satisfaccion.csv'), encuesta);

// ---------- Muestras para pruebas ----------
fs.writeFileSync(path.join(SAMPLES, 'con_errores.csv'), [
  'producto,cantidad,precio,fecha,activo',
  'Lápiz,10,1500,2025-01-10,sí',
  'Borrador,abc,800,2025-01-11,no',
  'Regla,,2500,fecha-mala,sí',
  'Lápiz,10,1500,2025-01-10,sí',
  '=HYPERLINK("http://ejemplo"),5,100,2025-01-12,no',
  'Cuaderno,7,9000,2025-01-13,',
  'Tijeras,3,99999999,2025-01-14,sí',
  'Pegante,4,3200,2025-01-15,no',
  'Marcador,6,2800,2025-01-16,sí',
].join('\n'));
fs.writeFileSync(path.join(SAMPLES, 'vacio.csv'), 'columna_a,columna_b\n');
fs.writeFileSync(path.join(SAMPLES, 'invalido.json'), '{"data": [ {"a": 1}, ');
fs.writeFileSync(path.join(SAMPLES, 'proyectos.json'), JSON.stringify([
  { proyecto: 'Migración ERP', responsable: 'Equipo A', estado: 'En curso', avance_pct: 65, presupuesto: 120000000, inicio: '2025-02-01', prioridad: 'Alta' },
  { proyecto: 'App móvil', responsable: 'Equipo B', estado: 'Planeado', avance_pct: 5, presupuesto: 80000000, inicio: '2025-06-15', prioridad: 'Media' },
  { proyecto: 'Portal de clientes', responsable: 'Equipo A', estado: 'Terminado', avance_pct: 100, presupuesto: 45000000, inicio: '2024-09-01', prioridad: 'Alta' },
  { proyecto: 'BI comercial', responsable: 'Equipo C', estado: 'En curso', avance_pct: 40, presupuesto: 30000000, inicio: '2025-03-10', prioridad: 'Alta' },
  { proyecto: 'Capacitación', responsable: 'Equipo C', estado: 'En curso', avance_pct: 75, presupuesto: 12000000, inicio: '2025-01-20', prioridad: 'Baja' },
  { proyecto: 'Ciberseguridad', responsable: 'Equipo B', estado: 'Planeado', avance_pct: 0, presupuesto: 95000000, inicio: '2025-08-01', prioridad: 'Alta' },
], null, 2));

const dbPath = path.join(SAMPLES, 'operaciones.sqlite');
fs.rmSync(dbPath, { force: true });
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE produccion (id INTEGER PRIMARY KEY, fecha TEXT, planta TEXT, turno TEXT, unidades_producidas INTEGER, defectos INTEGER, tiempo_parada_min REAL);
         CREATE TABLE maquinas (codigo TEXT PRIMARY KEY, planta TEXT, tipo TEXT, anio_compra INTEGER);`);
const ins = db.prepare('INSERT INTO produccion (fecha, planta, turno, unidades_producidas, defectos, tiempo_parada_min) VALUES (?,?,?,?,?,?)');
for (let i = 0; i < 180; i++) {
  const parada = round(rnd() * 90, 1);
  const unidades = Math.round(1200 - parada * 6 + rnd() * 200);
  ins.run(iso(addDays(new Date(Date.UTC(2025, 3, 1)), Math.floor(i / 3))), pick(['Planta Norte', 'Planta Sur']), ['Mañana', 'Tarde', 'Noche'][i % 3], unidades, Math.round(unidades * (0.01 + rnd() * 0.03)), parada);
}
const insM = db.prepare('INSERT INTO maquinas VALUES (?,?,?,?)');
for (let i = 1; i <= 12; i++) insM.run(`M-${i}`, pick(['Planta Norte', 'Planta Sur']), pick(['Prensa', 'Torno', 'Empacadora']), int(2010, 2024));
db.close();

console.log('Datos generados en data/demo y data/samples.');
