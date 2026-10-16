// Detección de tipos y conversión de valores. Módulo compartido navegador/servidor (sin dependencias).

export const TYPES = ['numerico', 'fecha', 'booleano', 'categoria', 'texto'];
export const TYPE_LABELS = {
  numerico: 'Numérico',
  fecha: 'Fecha',
  booleano: 'Booleano',
  categoria: 'Categoría',
  texto: 'Texto',
};

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'n.a.', 'null', 'none', 'nan', '-', '--', 'sin dato', 'sin datos', 'undefined', '#n/a']);
const TRUE_TOKENS = new Set(['true', 'verdadero', 'si', 'sí', 'yes', 'activo']);
const FALSE_TOKENS = new Set(['false', 'falso', 'no', 'inactivo']);

export function isMissing(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'number') return Number.isNaN(v);
  if (typeof v === 'string') return MISSING_TOKENS.has(v.trim().toLowerCase());
  return false;
}

export function parseBoolean(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (TRUE_TOKENS.has(s)) return true;
  if (FALSE_TOKENS.has(s)) return false;
  return null;
}

// Acepta 1234.5 · 1,234.5 · 1.234,5 · $ 1.200.000 · 45% · (300). Un único punto se interpreta como decimal.
export function parseNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/^(COP|USD|EUR|MXN)\s*/i, '').replace(/[$€£¥\s ]/g, '').replace(/%$/, '');
  if (!/^[+-]?[\d.,]+(?:[eE][+-]?\d+)?$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot > -1 && lastComma > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    if (/^[+-]?\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
    else if ((s.match(/,/g) || []).length === 1) s = s.replace(',', '.');
    else return null;
  } else if ((s.match(/\./g) || []).length > 1) {
    if (/^[+-]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    else return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

function validYmd(y, m, d) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// Devuelve un timestamp UTC (ms) o null. Los números nunca se interpretan como fechas.
export function parseDate(v) {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validYmd(y, mo, d)) return null;
    return Date.UTC(y, mo - 1, d, +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    // Convención hispana día/mes/año; si el segundo número es > 12 se asume mes/día/año.
    let [d, mo] = [+m[1], +m[2]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return validYmd(+m[3], mo, d) ? Date.UTC(+m[3], mo - 1, d) : null;
  }
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return validYmd(+m[1], +m[2], 1) ? Date.UTC(+m[1], +m[2] - 1, 1) : null;
  return null;
}

export function toISODate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

const ID_NAME = /^(id|sku|uuid|codigo|código|cod)$|^(id|cod|codigo|código)[_\s-]|[_\s-](id|cod|codigo|código)$/i;

export function isIdentifierName(name) {
  return ID_NAME.test(String(name).trim());
}

// Infiere el tipo de una columna a partir de sus valores crudos.
export function inferColumn(name, values) {
  const present = values.filter((v) => !isMissing(v));
  const n = present.length;
  const counts = { booleano: 0, numerico: 0, fecha: 0 };
  const distinct = new Set();
  let integers = 0;
  for (const v of present) {
    distinct.add(typeof v === 'string' ? v.trim() : String(v));
    if (parseBoolean(v) !== null) counts.booleano++;
    const num = parseNumber(v);
    if (num !== null) { counts.numerico++; if (Number.isInteger(num)) integers++; }
    else if (parseDate(v) !== null) counts.fecha++;
  }
  const unique = distinct.size;
  const threshold = 0.8;
  let type = 'texto';
  let matched = n;
  if (n === 0) type = 'texto';
  else if (counts.booleano / n >= threshold) { type = 'booleano'; matched = counts.booleano; }
  else if (counts.numerico / n >= threshold) { type = 'numerico'; matched = counts.numerico; }
  else if (counts.fecha / n >= threshold) { type = 'fecha'; matched = counts.fecha; }
  else if (unique <= 50 && unique / n <= 0.6) type = 'categoria';

  const idName = isIdentifierName(name);
  let role = 'atributo';
  if (idName || (type === 'texto' && n >= 10 && unique === n)) role = 'identificador';
  else if (type === 'numerico') role = 'medida';
  else if (type === 'categoria' || type === 'booleano') role = 'dimension';
  else if (type === 'fecha') role = 'tiempo';

  return {
    name,
    type,
    detectedType: type,
    role,
    present: n,
    missing: values.length - n,
    invalid: type === 'texto' || type === 'categoria' ? 0 : n - matched,
    unique,
    discrete: type === 'numerico' && n > 0 && integers === counts.numerico && unique <= 12 && unique / n <= 0.5,
    sample: [...distinct].slice(0, 3),
  };
}

export function inferSchema(columns, rows) {
  return {
    columns: columns.map((name) => inferColumn(name, rows.map((r) => r[name]))),
  };
}

// Convierte un valor crudo al tipo de la columna; null si falta o no es válido.
export function convertValue(v, type) {
  if (isMissing(v)) return null;
  switch (type) {
    case 'numerico': return parseNumber(v);
    case 'fecha': return parseDate(v);
    case 'booleano': return parseBoolean(v);
    default: return String(v).trim();
  }
}
