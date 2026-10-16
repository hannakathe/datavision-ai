import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNumber, parseDate, parseBoolean, inferSchema, isMissing } from '../public/js/core/types.js';
import { analyzeQuality } from '../public/js/core/quality.js';
import { prepare, applyFilters, groupBy } from '../public/js/core/data.js';
import { suggestDashboard, computeChart, computeKpi, validateChart, sanitizeConfig } from '../public/js/core/dashboard.js';
import { generateInsights } from '../public/js/core/insights.js';
import { pearson, iqrOutliers } from '../public/js/core/stats.js';

const build = (columns, rows) => {
  const objs = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  const schema = inferSchema(columns, objs);
  return { schema, prep: prepare(objs, schema), rows: objs };
};

test('parseNumber reconoce formatos numéricos comunes', () => {
  assert.equal(parseNumber('1234.5'), 1234.5);
  assert.equal(parseNumber('1.234.567,50'), 1234567.5);
  assert.equal(parseNumber('1,234,567.50'), 1234567.5);
  assert.equal(parseNumber('$ 1.200.000'), 1200000);
  assert.equal(parseNumber('45%'), 45);
  assert.equal(parseNumber('(300)'), -300);
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('=1+1'), null);
  assert.equal(parseNumber('2025-01-01'), null);
});

test('parseDate admite ISO, día/mes/año y año-mes; rechaza fechas imposibles', () => {
  assert.equal(new Date(parseDate('2025-03-09')).toISOString().slice(0, 10), '2025-03-09');
  assert.equal(new Date(parseDate('09/03/2025')).toISOString().slice(0, 10), '2025-03-09');
  assert.equal(new Date(parseDate('2025-07')).toISOString().slice(0, 10), '2025-07-01');
  assert.equal(parseDate('2025-02-30'), null);
  assert.equal(parseDate('20250101'), null);
  assert.equal(parseBoolean('Sí'), true);
  assert.equal(parseBoolean('no'), false);
  assert.ok(isMissing('N/A') && isMissing('  ') && !isMissing(0));
});

test('inferSchema clasifica tipos y roles', () => {
  const { schema } = build(['id', 'fecha', 'region', 'ventas', 'activo', 'nota'],
    Array.from({ length: 20 }, (_, i) => [i + 1, `2025-01-${String(i + 1).padStart(2, '0')}`, ['Norte', 'Sur'][i % 2], String(100 + i * 3), i % 3 ? 'sí' : 'no', `comentario ${i}`]));
  const t = Object.fromEntries(schema.columns.map((c) => [c.name, [c.type, c.role]]));
  assert.deepEqual(t.id, ['numerico', 'identificador']);
  assert.deepEqual(t.fecha, ['fecha', 'tiempo']);
  assert.deepEqual(t.region, ['categoria', 'dimension']);
  assert.deepEqual(t.ventas, ['numerico', 'medida']);
  assert.deepEqual(t.activo, ['booleano', 'dimension']);
  assert.equal(t.nota[0], 'texto');
});

test('analyzeQuality detecta faltantes, inválidos, duplicados, atípicos y fórmulas', () => {
  const { schema, rows } = build(['producto', 'cantidad'], [
    ['A', '10'], ['B', 'abc'], ['C', ''], ['A', '10'], ['=CMD()', '11'], ['D', '12'], ['E', '9'], ['F', '10'], ['G', '11'], ['H', '1000'],
  ]);
  const q = analyzeQuality(rows, schema);
  assert.equal(q.duplicateCount, 1);
  assert.equal(q.byColumn.cantidad.missing, 1);
  assert.equal(q.byColumn.cantidad.invalid, 1);
  assert.ok(q.byColumn.cantidad.outliers.count >= 1);
  assert.equal(q.formulaCells, 1);
  assert.equal(q.status, 'con_advertencias');
  assert.equal(analyzeQuality([], { columns: [] }).status, 'con_errores');
});

test('el dashboard se adapta a esquemas distintos sin nombres predefinidos', () => {
  const a = build(['mes', 'sede', 'ingresos'], Array.from({ length: 24 }, (_, i) => [`2024-${String((i % 12) + 1).padStart(2, '0')}`, ['X', 'Y', 'Z'][i % 3], 1000 + i * 10]));
  const ca = suggestDashboard(a.schema, a.prep);
  assert.ok(ca.charts.some((c) => c.type === 'line' && c.x === 'mes' && c.y === 'ingresos' && c.op === 'sum'));
  assert.ok(ca.kpis.some((k) => k.column === 'ingresos' && k.op === 'sum'));

  const b = build(['empleado', 'area', 'edad', 'evaluacion'], Array.from({ length: 30 }, (_, i) => [`E${i}`, ['TI', 'RRHH'][i % 2], 20 + i, 3 + (i % 3) * 0.5]));
  const cb = suggestDashboard(b.schema, b.prep);
  assert.ok(!cb.charts.some((c) => c.type === 'line'), 'sin fecha no hay líneas temporales');
  assert.ok(cb.kpis.some((k) => k.column === 'edad' && k.op === 'avg'), 'edad no se suma');
  for (const spec of [...ca.charts, ...cb.charts]) {
    const prep = ca.charts.includes(spec) ? a.prep : b.prep;
    const r = computeChart(prep, prep.allIdx, spec);
    assert.ok(!r.error, `${spec.type} ${spec.x}: ${r.error}`);
  }
});

test('validateChart rechaza combinaciones engañosas o imposibles', () => {
  const { schema } = build(['region', 'ventas', 'precio'], [['N', 1, 5], ['S', 2, 6], ['N', 3, 7]]);
  assert.equal(validateChart({ type: 'pie', x: 'region', y: 'ventas', op: 'avg' }, schema).ok, false);
  assert.equal(validateChart({ type: 'line', x: 'region', y: 'ventas', op: 'sum' }, schema).ok, false);
  assert.equal(validateChart({ type: 'scatter', x: 'region', y: 'ventas', op: 'count' }, schema).ok, false);
  assert.equal(validateChart({ type: 'bar', x: 'region', y: null, op: 'sum' }, schema).ok, false);
  assert.equal(validateChart({ type: 'bar', x: 'region', y: 'ventas', op: 'sum' }, schema).ok, true);
  assert.ok(validateChart({ type: 'bar', x: 'region', y: 'precio', op: 'sum' }, schema).warnings.length > 0);
});

test('filtros, agrupación con «Otros» y KPI recalculados', () => {
  const { prep } = build(['cat', 'v', 'f'], Array.from({ length: 40 }, (_, i) => [`c${i % 20}`, i, `2025-0${(i % 3) + 1}-10`]));
  const idx = applyFilters(prep, [{ column: 'cat', op: 'in', values: ['c1', 'c2'] }]);
  assert.equal(idx.length, 4);
  assert.equal(applyFilters(prep, [{ column: 'v', op: 'range', min: 10, max: 19 }]).length, 10);
  assert.equal(applyFilters(prep, [], 'c19').length, 2);
  const g = groupBy(prep, prep.allIdx, { dimension: 'cat', measure: 'v', op: 'sum', limit: 5 });
  assert.equal(g.labels.length, 5);
  assert.equal(g.labels[4], 'Otros');
  assert.equal(g.values.reduce((a, b) => a + b, 0), (39 * 40) / 2);
  const k = computeKpi(prep, idx, { id: 'k', op: 'sum', column: 'v' }, 'f');
  assert.equal(k.value, 1 + 2 + 21 + 22);
  assert.equal(computeKpi(prep, [], { id: 'k', op: 'count' }).value, 0);
  const empty = computeChart(prep, [], { type: 'bar', x: 'cat', op: 'count' });
  assert.match(empty.empty, /No hay registros/);
});

test('sanitizeConfig descarta columnas inexistentes y valores no permitidos', () => {
  const { schema } = build(['a', 'b'], [['x', 1], ['y', 2]]);
  const c = sanitizeConfig({ charts: [{ type: 'bar', x: 'a', op: 'count' }, { type: 'bar', x: 'no_existe' }, { type: 'evil', x: 'a' }], kpis: [{ op: 'sum', column: 'b' }, { op: 'eval', column: 'b' }], filters: [{ column: 'a', op: 'in', values: ['x'] }, { column: 'a', op: 'sql' }] }, schema);
  assert.equal(c.charts.length, 1);
  assert.equal(c.kpis.length, 1);
  assert.equal(c.filters.length, 1);
});

test('el análisis inteligente justifica cada conclusión y no afirma causalidad', () => {
  const n = 60;
  const { prep, schema, rows } = build(['espera', 'calificacion', 'ciudad'], Array.from({ length: n }, (_, i) => [i, 100 - i * 1.5 + (i % 5), ['A', 'B', 'C'][i % 3]]));
  const items = generateInsights(prep, prep.allIdx, analyzeQuality(rows, schema));
  assert.ok(items.every((i) => i.evidence && i.text));
  const corr = items.find((i) => i.category === 'correlacion');
  assert.ok(corr, 'debe detectar la correlación');
  assert.match(corr.text, /no causalidad/);
  const few = generateInsights(prep, [0, 1], null);
  assert.ok(few.some((i) => i.category === 'limitacion'));
  assert.ok(generateInsights(prep, [], null).some((i) => /Sin registros/.test(i.title)));
});

test('estadística básica', () => {
  assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]).r - 1) < 1e-9);
  assert.equal(iqrOutliers([1, 2, 3, 4, 5, 6, 7, 8, 100]).count, 1);
});
