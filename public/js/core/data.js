// Preparación de datos tipados, filtros y agregaciones por grupo.
import { convertValue } from './types.js';
import { sum, mean, median, min, max } from './stats.js';

export const EMPTY_LABEL = '(vacío)';
export const OTHERS_LABEL = 'Otros';

export const OPS = {
  count: 'Recuento',
  sum: 'Suma',
  avg: 'Promedio',
  median: 'Mediana',
  min: 'Mínimo',
  max: 'Máximo',
  distinct: 'Valores únicos',
};

export const GRAINS = { day: 'Día', month: 'Mes', quarter: 'Trimestre', year: 'Año' };

export function prepare(rows, schema) {
  const cols = {};
  const colMap = {};
  for (const c of schema.columns) {
    colMap[c.name] = c;
    cols[c.name] = rows.map((r) => convertValue(r[c.name], c.type));
  }
  return { rows, schema, cols, colMap, n: rows.length, allIdx: rows.map((_, i) => i) };
}

export function chooseGrain(minTs, maxTs) {
  const days = (maxTs - minTs) / 864e5;
  if (days <= 62) return 'day';
  if (days <= 3 * 366) return 'month';
  if (days <= 8 * 366) return 'quarter';
  return 'year';
}

export function periodLabel(ts, grain = 'day') {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (grain === 'year') return String(y);
  if (grain === 'quarter') return `${y}-T${Math.ceil(m / 3)}`;
  if (grain === 'month') return `${y}-${String(m).padStart(2, '0')}`;
  return d.toISOString().slice(0, 10);
}

export function labelOf(v, type, grain) {
  if (v === null || v === undefined) return EMPTY_LABEL;
  if (type === 'booleano') return v ? 'Sí' : 'No';
  if (type === 'fecha') return periodLabel(v, grain);
  return String(v);
}

function isActive(f) {
  if (f.op === 'in') return Array.isArray(f.values) && f.values.length > 0;
  if (f.op === 'range') return (f.min !== null && f.min !== undefined && f.min !== '') || (f.max !== null && f.max !== undefined && f.max !== '');
  if (f.op === 'contains') return typeof f.text === 'string' && f.text.trim() !== '';
  return false;
}

function matches(v, f, type) {
  if (f.op === 'in') return f.values.includes(labelOf(v, type, f.grain));
  if (v === null) return false;
  if (f.op === 'range') {
    const lo = f.min === '' || f.min === undefined ? null : Number(f.min);
    const hi = f.max === '' || f.max === undefined ? null : Number(f.max);
    return (lo === null || v >= lo) && (hi === null || v <= hi);
  }
  if (f.op === 'contains') return String(v).toLowerCase().includes(f.text.trim().toLowerCase());
  return true;
}

export function activeFilters(prep, filters = []) {
  return filters.filter((f) => f && prep.colMap[f.column] && isActive(f));
}

// Devuelve los índices de las filas que cumplen todos los filtros y la búsqueda global.
export function applyFilters(prep, filters = [], search = '') {
  const active = activeFilters(prep, filters);
  const q = (search || '').trim().toLowerCase();
  if (q && !prep._search) {
    prep._search = prep.rows.map((r) => Object.values(r).map((v) => (v === null || v === undefined ? '' : String(v))).join(' ').toLowerCase());
  }
  const out = [];
  for (let i = 0; i < prep.n; i++) {
    let ok = true;
    for (const f of active) {
      if (!matches(prep.cols[f.column][i], f, prep.colMap[f.column].type)) { ok = false; break; }
    }
    if (ok && q && !prep._search[i].includes(q)) ok = false;
    if (ok) out.push(i);
  }
  return out;
}

export function aggregate(op, vals, count) {
  switch (op) {
    case 'count': return count;
    case 'sum': return vals.length ? sum(vals) : null;
    case 'avg': return mean(vals);
    case 'median': return median(vals);
    case 'min': return min(vals);
    case 'max': return max(vals);
    case 'distinct': return new Set(vals).size;
    default: throw new Error(`Operación no soportada: ${op}`);
  }
}

// Agrupa por una dimensión y agrega una medida. Las dimensiones temporales se ordenan cronológicamente.
export function groupBy(prep, idx, { dimension, measure, op = 'count', grain, limit = 0, sort = 'value', dropEmpty = false }) {
  const dimType = prep.colMap[dimension].type;
  const dcol = prep.cols[dimension];
  const mcol = measure ? prep.cols[measure] : null;
  const groups = new Map();
  for (const i of idx) {
    const label = labelOf(dcol[i], dimType, grain);
    let g = groups.get(label);
    if (!g) { g = { label, vals: [], count: 0, sortKey: dcol[i] }; groups.set(label, g); }
    g.count++;
    if (mcol && mcol[i] !== null) g.vals.push(mcol[i]);
  }
  let entries = [...groups.values()];
  let dropped = 0;
  if (dropEmpty && groups.has(EMPTY_LABEL)) {
    dropped = groups.get(EMPTY_LABEL).count;
    entries = entries.filter((g) => g.label !== EMPTY_LABEL);
  }
  const ordered = dimType === 'fecha' || (dimType === 'numerico' && sort !== 'value');
  for (const g of entries) g.value = aggregate(op, g.vals, g.count);
  if (ordered) {
    entries.sort((a, b) => (a.sortKey === null) - (b.sortKey === null) || (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
  } else {
    entries.sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.label.localeCompare(b.label, 'es'));
  }
  const totalGroups = entries.length;
  let truncated = false;
  if (!ordered && limit > 0 && entries.length > limit) {
    const kept = entries.slice(0, limit - 1);
    const rest = entries.slice(limit - 1);
    const vals = rest.flatMap((g) => g.vals);
    const count = rest.reduce((a, g) => a + g.count, 0);
    const otherValue = op === 'distinct' ? null : aggregate(op, vals, count);
    kept.push({ label: OTHERS_LABEL, vals, count, value: otherValue, others: rest.map((g) => g.label) });
    entries = kept;
    truncated = true;
  }
  return {
    labels: entries.map((g) => g.label),
    values: entries.map((g) => g.value),
    counts: entries.map((g) => g.count),
    others: entries.find((g) => g.others)?.others || [],
    totalGroups,
    truncated,
    dropped,
  };
}

export function distinctLabels(prep, column, limit = 200) {
  const type = prep.colMap[column].type;
  const counts = new Map();
  for (const v of prep.cols[column]) {
    const l = labelOf(v, type);
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, count]) => ({ label, count }));
}
