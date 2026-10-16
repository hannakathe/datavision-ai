// Generador dinámico de dashboards: sugiere KPI y gráficas según el esquema, valida configuraciones y calcula resultados.
import { OPS, GRAINS, groupBy, chooseGrain, periodLabel, OTHERS_LABEL, aggregate } from './data.js';
import { pearson, linearTrend, min as minOf, max as maxOf } from './stats.js';
import { fmtNumber, fmtPct, fmtDate } from './format.js';

export const CHART_TYPES = {
  hbar: 'Barras horizontales',
  bar: 'Barras verticales',
  line: 'Líneas',
  doughnut: 'Dona',
  pie: 'Sectores',
  histogram: 'Histograma',
  scatter: 'Dispersión',
};

export const PAGES = {
  resumen: 'Resumen ejecutivo',
  tendencias: 'Tendencias',
  distribuciones: 'Distribuciones',
  relaciones: 'Relaciones',
};

export const KPI_OPS = { ...OPS, pct_true: '% de «Sí»', range: 'Rango de fechas' };

const ADDITIVE = /(venta|monto|total|ingreso|costo|gasto|importe|unidades|cantidad|stock|existencia|presupuesto|ejecutado|utilidad|ganancia|pedido|revenue|sales|amount|qty|quantity|horas|visitas|clics|leads)/i;
const NON_ADDITIVE = /(precio|unitari|tasa|porcentaje|pct|ratio|promedio|edad|calificaci|puntaje|rating|score|[ií]ndice|nivel|nota|satisfacci|margen|descuento|temperatura|a[ñn]o|mes|minimo|mínimo)/i;

const PRIMARY = /(total|venta|ingreso|monto|importe|revenue|sales|amount|ejecutado)/i;

export function isAdditive(name) {
  return ADDITIVE.test(name) && !NON_ADDITIVE.test(name);
}

// Prioridad de una medida para el dashboard automático: montos totales > otras aditivas > resto.
function measureScore(c) {
  if (!isAdditive(c.name)) return 0;
  return PRIMARY.test(c.name) ? 2 : 1;
}

const MAX_PIE = 8;

export function profileSchema(schema) {
  const cols = schema.columns.filter((c) => c.present > 0);
  const measures = cols
    .filter((c) => c.type === 'numerico' && c.role !== 'identificador')
    .sort((a, b) => measureScore(b) - measureScore(a));
  const dates = cols.filter((c) => c.type === 'fecha');
  const categorical = cols
    .filter((c) => c.role !== 'identificador' && c.unique >= 2 && (c.type === 'categoria' || c.type === 'booleano'))
    .sort((a, b) => a.unique - b.unique);
  // Los números discretos (p. ej. calificación 1–5) solo se usan como dimensión si no hay categorías.
  const dims = categorical.length ? categorical : cols.filter((c) => c.type === 'numerico' && c.discrete && c.role !== 'identificador');
  const booleans = cols.filter((c) => c.type === 'booleano');
  return { measures, dates, dims, booleans };
}

export function defaultOp(column) {
  if (!column) return 'count';
  return isAdditive(column.name) ? 'sum' : 'avg';
}

export function autoTitle(spec) {
  const measure = spec.y && spec.op !== 'count' ? `${OPS[spec.op] || spec.op} de ${spec.y}` : 'Recuento de registros';
  switch (spec.type) {
    case 'histogram': return `Distribución de ${spec.x}`;
    case 'scatter': return `${spec.y} frente a ${spec.x}`;
    case 'line': return `${measure} por ${GRAINS[spec.grain]?.toLowerCase() || 'período'} (${spec.x})`;
    default: return `${measure} por ${spec.x}`;
  }
}

// Construye la configuración automática de un dashboard para cualquier esquema.
export function suggestDashboard(schema, prep) {
  const { measures, dates, dims, booleans } = profileSchema(schema);
  let n = 0;
  const id = () => `g${++n}`;
  const kpis = [{ id: 'k1', op: 'count', column: null }];
  for (const m of measures.slice(0, 3)) kpis.push({ id: `k${kpis.length + 1}`, op: defaultOp(m), column: m.name });
  if (kpis.length < 4 && dims[0]) kpis.push({ id: `k${kpis.length + 1}`, op: 'distinct', column: dims[0].name });
  if (kpis.length < 4 && booleans[0]) kpis.push({ id: `k${kpis.length + 1}`, op: 'pct_true', column: booleans[0].name });
  if (kpis.length < 4 && dates[0]) kpis.push({ id: `k${kpis.length + 1}`, op: 'range', column: dates[0].name });

  const charts = [];
  const D = dates[0];
  const M = measures[0];
  const op0 = defaultOp(M);
  const add = (spec) => charts.push({ id: id(), title: '', limit: 0, grain: 'auto', trend: true, ...spec });

  // Resumen ejecutivo
  if (D) add({ page: 'resumen', type: 'line', x: D.name, y: M?.name || null, op: M ? op0 : 'count' });
  // Dimensión principal: la categoría con un número de grupos más cercano a 6 (legible y con variedad).
  const mainDim = [...dims].sort((a, b) => Math.abs(a.unique - 6) - Math.abs(b.unique - 6) || a.unique - b.unique)[0];
  if (mainDim) add({ page: 'resumen', type: 'hbar', x: mainDim.name, y: M?.name || null, op: M ? op0 : 'count', limit: 10 });
  const small = dims.find((d) => d.unique <= 6 && d !== mainDim);
  if (small) {
    const useSum = M && isAdditive(M.name);
    add({ page: 'resumen', type: 'doughnut', x: small.name, y: useSum ? M.name : null, op: useSum ? 'sum' : 'count' });
  }
  if (!D && !dims.length && M) add({ page: 'resumen', type: 'histogram', x: M.name, y: null, op: 'count' });

  // Tendencias
  if (D) {
    for (const m of measures.slice(1, 3)) add({ page: 'tendencias', type: 'line', x: D.name, y: m.name, op: defaultOp(m) });
    add({ page: 'tendencias', type: 'bar', x: D.name, y: null, op: 'count', trend: false });
  }

  // Distribuciones
  for (const m of measures.slice(0, 3)) add({ page: 'distribuciones', type: 'histogram', x: m.name, y: null, op: 'count' });
  for (const d of dims.filter((x) => x !== mainDim).slice(0, 2)) add({ page: 'distribuciones', type: 'bar', x: d.name, y: null, op: 'count', limit: 15 });

  // Relaciones
  if (prep && measures.length >= 2) {
    const pairs = [];
    const ms = measures.slice(0, 6);
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const { r } = pearson(prep.cols[ms[i].name], prep.cols[ms[j].name]);
        if (r !== null) pairs.push({ x: ms[i].name, y: ms[j].name, r });
      }
    }
    pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
    for (const p of pairs.slice(0, 2)) add({ page: 'relaciones', type: 'scatter', x: p.x, y: p.y, op: 'count' });
  }
  const relDim = dims.find((d) => d !== mainDim && d.type !== 'booleano') || mainDim;
  if (relDim && M && relDim.name !== M.name) add({ page: 'relaciones', type: 'bar', x: relDim.name, y: M.name, op: 'avg', limit: 15 });

  return { version: 1, kpis: kpis.slice(0, 4), charts, filters: [] };
}

// Comprueba que una gráfica tenga sentido para los tipos de columna disponibles.
export function validateChart(spec, schema) {
  const errors = [];
  const warnings = [];
  const col = (name) => schema.columns.find((c) => c.name === name);
  const x = col(spec.x);
  const y = spec.y ? col(spec.y) : null;
  if (!CHART_TYPES[spec.type]) errors.push('Tipo de gráfica no válido.');
  if (!x) errors.push(spec.x ? `La columna «${spec.x}» no existe en este conjunto de datos.` : 'Selecciona la columna principal (eje X / dimensión).');
  if (spec.y && !y) errors.push(`La columna «${spec.y}» no existe en este conjunto de datos.`);
  if (errors.length) return { ok: false, errors, warnings };

  const needsNumericY = !['count', 'distinct'].includes(spec.op);
  switch (spec.type) {
    case 'histogram':
      if (x.type !== 'numerico') errors.push('El histograma requiere una columna numérica.');
      break;
    case 'scatter':
      if (x.type !== 'numerico' || !y || y.type !== 'numerico') errors.push('La dispersión requiere dos columnas numéricas (X e Y).');
      break;
    case 'line':
      if (x.type !== 'fecha' && !(x.type === 'numerico' && x.discrete)) errors.push('Las líneas requieren una dimensión ordenada, normalmente una fecha. Para categorías usa barras.');
      break;
    default:
      if (x.type === 'numerico' && !x.discrete) errors.push(`«${x.name}» es numérica continua; para ver su distribución usa un histograma.`);
      if (x.type === 'texto') warnings.push(`«${x.name}» es texto libre con muchos valores distintos; solo se mostrarán los más frecuentes.`);
  }
  if (!['scatter', 'histogram'].includes(spec.type)) {
    if (!OPS[spec.op]) errors.push('Operación estadística no válida.');
    else if (needsNumericY && (!y || y.type !== 'numerico')) errors.push(`La operación «${OPS[spec.op]}» requiere una variable numérica.`);
    if ((spec.type === 'pie' || spec.type === 'doughnut') && !['count', 'sum'].includes(spec.op)) {
      errors.push('Los sectores representan partes de un total: usa recuento o suma, no promedios ni extremos.');
    }
    if (spec.op === 'sum' && y && !isAdditive(y.name)) warnings.push(`Verifica que sumar «${y.name}» tenga sentido (p. ej., sumar precios o edades no suele ser interpretable).`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

function resolveGrain(prep, spec) {
  if (prep.colMap[spec.x]?.type !== 'fecha') return undefined;
  if (spec.grain && spec.grain !== 'auto') return spec.grain;
  const all = prep.cols[spec.x];
  const lo = minOf(all);
  const hi = maxOf(all);
  return lo === null ? 'month' : chooseGrain(lo, hi);
}

function nextPeriod(label, grain) {
  if (grain === 'year') return String(+label + 1);
  if (grain === 'quarter') {
    const [y, q] = label.split('-T').map(Number);
    return q === 4 ? `${y + 1}-T1` : `${y}-T${q + 1}`;
  }
  if (grain === 'month') {
    const [y, m] = label.split('-').map(Number);
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  const d = new Date(`${label}T00:00:00Z`);
  return periodLabel(d.getTime() + 864e5, 'day');
}

export function computeChart(prep, idx, spec) {
  const v = validateChart(spec, prep.schema);
  const title = spec.title || autoTitle({ ...spec, grain: resolveGrain(prep, spec) || spec.grain });
  if (!v.ok) return { title, error: v.errors.join(' '), warnings: v.warnings };
  const notes = [...v.warnings];
  if (!idx.length) return { title, empty: 'No hay registros que cumplan los filtros actuales.', notes };

  if (spec.type === 'histogram') return histogram(prep, idx, spec, title, notes);
  if (spec.type === 'scatter') return scatter(prep, idx, spec, title, notes);

  const grain = resolveGrain(prep, spec);
  const isPie = spec.type === 'pie' || spec.type === 'doughnut';
  const limit = isPie ? Math.min(spec.limit || MAX_PIE, MAX_PIE) : spec.type === 'line' || grain ? 0 : spec.limit || 15;
  const y = spec.op === 'count' ? null : spec.y;
  const g = groupBy(prep, idx, { dimension: spec.x, measure: y, op: spec.op, grain, limit, dropEmpty: !!grain });

  if (isPie && g.values.some((val) => val !== null && val < 0)) {
    return { title, error: 'Los sectores no pueden representar valores negativos. Usa barras.', notes };
  }
  if (g.dropped) notes.push(`${g.dropped} registro(s) sin fecha válida en «${spec.x}» no se muestran.`);
  if (g.truncated) notes.push(`Se muestran ${g.labels.length - 1} grupos principales; ${g.others.length} grupos menores se agrupan en «${OTHERS_LABEL}».`);
  if (y) {
    const missing = idx.filter((i) => prep.cols[y][i] === null).length;
    if (missing) notes.push(`${missing} registro(s) sin valor en «${y}» no se incluyen en el cálculo.`);
  }
  if (spec.type === 'line' && g.labels.length < 2) notes.push('Solo hay un período: una línea no muestra tendencia con un único punto.');

  const drill = g.labels.map((label) => (label === OTHERS_LABEL
    ? { column: spec.x, op: 'in', values: g.others, grain }
    : { column: spec.x, op: 'in', values: [label], grain }));

  const result = {
    title,
    chartType: spec.type,
    labels: g.labels,
    datasets: [{ label: y ? `${OPS[spec.op]} de ${y}` : 'Recuento', data: g.values }],
    counts: g.counts,
    drill,
    notes,
    grain,
    valueLabel: y ? `${OPS[spec.op]} de ${y}` : 'Registros',
  };

  if (spec.type === 'line' && spec.trend !== false && grain && ['sum', 'count', 'avg', 'median'].includes(spec.op)) {
    const lt = linearTrend(g.values);
    if (lt && g.labels.length >= 4) {
      const horizon = 3;
      const labels = [...g.labels];
      let last = labels[labels.length - 1];
      for (let k = 0; k < horizon; k++) { last = nextPeriod(last, grain); labels.push(last); }
      const trend = labels.map((_, i) => lt.intercept + lt.slope * i);
      result.labels = labels;
      result.datasets[0].data = [...g.values, ...Array(horizon).fill(null)];
      result.datasets.push({ label: 'Tendencia lineal y proyección', data: trend, dashed: true });
      result.projectionFrom = g.labels.length;
      notes.push(`Línea punteada: tendencia por regresión lineal simple (R² = ${lt.r2.toFixed(2).replace('.', ',')}), proyectada ${horizon} períodos. Es una estimación estadística ingenua, sin estacionalidad; no es un pronóstico garantizado.`);
    }
  }
  return result;
}

function histogram(prep, idx, spec, title, notes) {
  const vals = idx.map((i) => prep.cols[spec.x][i]).filter((v) => v !== null);
  if (vals.length < 2) return { title, empty: `No hay suficientes valores numéricos en «${spec.x}» para una distribución.`, notes };
  const lo = minOf(vals);
  const hi = maxOf(vals);
  if (lo === hi) return { title, empty: `Todos los valores de «${spec.x}» son iguales (${fmtNumber(lo)}).`, notes };
  const k = Math.min(30, Math.max(5, Math.ceil(Math.log2(vals.length) + 1)));
  const w = (hi - lo) / k;
  const counts = Array(k).fill(0);
  for (const v of vals) counts[Math.min(k - 1, Math.floor((v - lo) / w))]++;
  const edges = counts.map((_, b) => [lo + b * w, b === k - 1 ? hi : lo + (b + 1) * w]);
  const missing = idx.length - vals.length;
  if (missing) notes.push(`${missing} registro(s) sin valor numérico en «${spec.x}» se excluyen.`);
  return {
    title,
    chartType: 'histogram',
    labels: edges.map(([a, b]) => `${fmtNumber(a, { compact: true })} – ${fmtNumber(b, { compact: true })}`),
    datasets: [{ label: 'Frecuencia', data: counts }],
    drill: edges.map(([a, b]) => ({ column: spec.x, op: 'range', min: a, max: b })),
    notes,
    valueLabel: 'Registros',
  };
}

function scatter(prep, idx, spec, title, notes) {
  const xs = prep.cols[spec.x];
  const ys = prep.cols[spec.y];
  const pts = [];
  for (const i of idx) if (xs[i] !== null && ys[i] !== null) pts.push({ x: xs[i], y: ys[i] });
  if (pts.length < 3) return { title, empty: 'Se necesitan al menos 3 registros con ambos valores para una dispersión.', notes };
  const { r, n } = pearson(idx.map((i) => xs[i]), idx.map((i) => ys[i]));
  let shown = pts;
  if (pts.length > 2000) {
    const step = pts.length / 2000;
    shown = Array.from({ length: 2000 }, (_, k) => pts[Math.floor(k * step)]);
    notes.push(`Se muestra una muestra sistemática de 2000 de ${pts.length} puntos.`);
  }
  if (r !== null) notes.push(`Correlación de Pearson r = ${r.toFixed(2).replace('.', ',')} (n = ${n}). Una correlación no demuestra que una variable cause la otra.`);
  return { title, chartType: 'scatter', points: shown, xLabel: spec.x, yLabel: spec.y, r, notes };
}

// KPI: valor principal, detalle, variación entre los dos últimos períodos y mini-serie (si hay columna de fecha).
export function computeKpi(prep, idx, spec, dateColumn) {
  const col = spec.column ? prep.cols[spec.column] : null;
  const out = { id: spec.id, label: '', display: '—', sub: '' };
  if (spec.column && !col) return { ...out, label: spec.column, sub: 'Columna no disponible en este conjunto.' };
  const vals = col ? idx.map((i) => col[i]).filter((v) => v !== null) : [];
  switch (spec.op) {
    case 'count':
      out.label = 'Registros';
      out.value = idx.length;
      out.display = fmtNumber(idx.length);
      out.sub = idx.length === prep.n ? 'Total del conjunto' : `de ${fmtNumber(prep.n)} en total`;
      break;
    case 'distinct': {
      out.label = `Valores únicos · ${spec.column}`;
      const counts = new Map();
      for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
      out.value = counts.size;
      out.display = fmtNumber(counts.size);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      out.sub = top ? `Más frecuente: ${prep.colMap[spec.column].type === 'booleano' ? (top[0] ? 'Sí' : 'No') : top[0]} (${fmtPct(top[1] / vals.length)})` : 'Sin valores';
      break;
    }
    case 'pct_true': {
      out.label = `% «Sí» · ${spec.column}`;
      const t = vals.filter((v) => v === true).length;
      out.value = vals.length ? t / vals.length : null;
      out.display = fmtPct(out.value);
      out.sub = `${fmtNumber(t)} de ${fmtNumber(vals.length)} con valor`;
      break;
    }
    case 'range': {
      out.label = `Período · ${spec.column}`;
      const lo = minOf(vals);
      const hi = maxOf(vals);
      out.display = lo === null ? '—' : `${fmtDate(lo)} → ${fmtDate(hi)}`;
      out.small = true;
      out.sub = lo === null ? 'Sin fechas válidas' : `${fmtNumber(Math.round((hi - lo) / 864e5) + 1)} días cubiertos`;
      break;
    }
    default: {
      if (!OPS[spec.op]) return { ...out, label: spec.column, sub: 'Operación no válida' };
      out.label = `${OPS[spec.op]} · ${spec.column}`;
      out.value = aggregate(spec.op, vals, vals.length);
      out.display = fmtNumber(out.value, { compact: true });
      out.sub = vals.length ? `Mín ${fmtNumber(minOf(vals), { compact: true })} · Máx ${fmtNumber(maxOf(vals), { compact: true })} · n = ${fmtNumber(vals.length)}` : 'Sin valores numéricos';
    }
  }
  if (dateColumn && prep.cols[dateColumn] && ['count', 'sum', 'avg', 'median', 'min', 'max'].includes(spec.op)) {
    const grain = resolveGrain(prep, { x: dateColumn, grain: 'auto' });
    const g = groupBy(prep, idx, { dimension: dateColumn, measure: spec.op === 'count' ? null : spec.column, op: spec.op, grain, dropEmpty: true });
    const series = g.labels.map((l, i) => [l, g.values[i]]).filter(([, v]) => v !== null);
    // La variación solo se muestra con granularidad mensual o trimestral y al menos 3 períodos, para no comparar años de alta u otras fechas descriptivas.
    if (series.length >= 3 && (grain === 'month' || grain === 'quarter')) {
      out.spark = series.slice(-12).map(([, v]) => v);
      const [prevL, prev] = series[series.length - 2];
      const [lastL, last] = series[series.length - 1];
      // Solo se compara con el período inmediatamente anterior (sin huecos) para no presentar variaciones engañosas.
      if (prev && nextPeriod(prevL, grain) === lastL) {
        const pct = (last - prev) / Math.abs(prev);
        out.delta = { pct, text: `${pct >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(pct))} ${lastL} vs ${prevL}` };
      }
    }
  }
  return out;
}

// Normaliza y valida una configuración guardada contra el esquema actual (descarta referencias inválidas).
export function sanitizeConfig(config, schema) {
  const names = new Set(schema.columns.map((c) => c.name));
  const okCol = (c) => c === null || c === undefined || names.has(c);
  const charts = (Array.isArray(config?.charts) ? config.charts : [])
    .filter((c) => c && CHART_TYPES[c.type] && names.has(c.x) && okCol(c.y))
    .slice(0, 24)
    .map((c, i) => ({
      id: String(c.id || `g${i + 1}`).slice(0, 20),
      page: PAGES[c.page] ? c.page : 'resumen',
      type: c.type,
      x: c.x,
      y: c.y || null,
      op: OPS[c.op] ? c.op : 'count',
      grain: GRAINS[c.grain] ? c.grain : 'auto',
      limit: Math.max(0, Math.min(50, Number(c.limit) || 0)),
      trend: c.trend !== false,
      title: String(c.title || '').slice(0, 120),
    }));
  const kpis = (Array.isArray(config?.kpis) ? config.kpis : [])
    .filter((k) => k && KPI_OPS[k.op] && okCol(k.column))
    .slice(0, 8)
    .map((k, i) => ({ id: String(k.id || `k${i + 1}`).slice(0, 20), op: k.op, column: k.column || null }));
  const filters = (Array.isArray(config?.filters) ? config.filters : [])
    .filter((f) => f && names.has(f.column) && ['in', 'range', 'contains'].includes(f.op))
    .slice(0, 30)
    .map((f) => ({
      column: f.column,
      op: f.op,
      values: Array.isArray(f.values) ? f.values.slice(0, 500).map(String) : undefined,
      min: f.min ?? undefined,
      max: f.max ?? undefined,
      text: typeof f.text === 'string' ? f.text.slice(0, 200) : undefined,
      grain: GRAINS[f.grain] ? f.grain : undefined,
    }));
  return { version: 1, kpis, charts, filters, search: typeof config?.search === 'string' ? config.search.slice(0, 200) : '' };
}
