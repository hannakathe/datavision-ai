// Estadística descriptiva básica. Todas las funciones ignoran null.

const clean = (arr) => arr.filter((v) => v !== null && v !== undefined && Number.isFinite(v));

export function sum(arr) {
  let s = 0;
  for (const v of arr) if (v !== null && Number.isFinite(v)) s += v;
  return s;
}

export function mean(arr) {
  const c = clean(arr);
  return c.length ? sum(c) / c.length : null;
}

export function sorted(arr) {
  return clean(arr).sort((a, b) => a - b);
}

export function quantileSorted(s, q) {
  if (!s.length) return null;
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function median(arr) {
  return quantileSorted(sorted(arr), 0.5);
}

export function min(arr) {
  let m = null;
  for (const v of arr) if (v !== null && Number.isFinite(v) && (m === null || v < m)) m = v;
  return m;
}

export function max(arr) {
  let m = null;
  for (const v of arr) if (v !== null && Number.isFinite(v) && (m === null || v > m)) m = v;
  return m;
}

export function std(arr) {
  const c = clean(arr);
  if (c.length < 2) return null;
  const m = sum(c) / c.length;
  return Math.sqrt(c.reduce((a, v) => a + (v - m) ** 2, 0) / (c.length - 1));
}

// Correlación de Pearson sobre pares completos. Devuelve { r, n }.
export function pearson(xs, ys) {
  const px = [];
  const py = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] !== null && ys[i] !== null && Number.isFinite(xs[i]) && Number.isFinite(ys[i])) {
      px.push(xs[i]);
      py.push(ys[i]);
    }
  }
  const n = px.length;
  if (n < 3) return { r: null, n };
  const mx = sum(px) / n;
  const my = sum(py) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (px[i] - mx) * (py[i] - my);
    dx += (px[i] - mx) ** 2;
    dy += (py[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return { r: null, n };
  return { r: num / Math.sqrt(dx * dy), n };
}

// Regresión lineal simple y = a + b·x sobre índices 0..n-1.
export function linearTrend(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && Number.isFinite(v));
  const n = pts.length;
  if (n < 3) return null;
  const mx = pts.reduce((a, [x]) => a + x, 0) / n;
  const my = pts.reduce((a, [, y]) => a + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

// Valores atípicos por rango intercuartílico (1.5·IQR).
export function iqrOutliers(arr) {
  const s = sorted(arr);
  if (s.length < 8) return { count: 0, lower: null, upper: null, n: s.length, insufficient: true };
  const q1 = quantileSorted(s, 0.25);
  const q3 = quantileSorted(s, 0.75);
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  const out = s.filter((v) => v < lower || v > upper);
  return { count: out.length, lower, upper, q1, q3, n: s.length, examples: [...new Set(out)].slice(-3) };
}

export function describe(arr) {
  const s = sorted(arr);
  return {
    n: s.length,
    sum: sum(s),
    mean: s.length ? sum(s) / s.length : null,
    median: quantileSorted(s, 0.5),
    min: s.length ? s[0] : null,
    max: s.length ? s[s.length - 1] : null,
    std: std(s),
    q1: quantileSorted(s, 0.25),
    q3: quantileSorted(s, 0.75),
  };
}
