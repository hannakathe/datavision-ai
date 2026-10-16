// Formateo de números y fechas en español.
const LOCALE = 'es-CO';

export function fmtNumber(v, { compact = false, decimals } = {}) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (compact && abs >= 10000) {
    return new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  }
  const d = decimals ?? (Number.isInteger(v) ? 0 : abs >= 100 ? 1 : 2);
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(v);
}

export function fmtPct(ratio, decimals = 1) {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(decimals).replace('.', ',')} %`;
}

export function fmtDate(ts) {
  if (ts === null || ts === undefined) return '—';
  return new Date(ts).toISOString().slice(0, 10);
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}
