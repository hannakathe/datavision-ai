// Diagnóstico de calidad: faltantes, duplicados, valores inválidos, atípicos y posible contenido de fórmulas.
import { convertValue, isMissing, TYPE_LABELS } from './types.js';
import { iqrOutliers } from './stats.js';

const FORMULA_LIKE = /^[=+@]|^-[A-Za-z(]/;

export function rowKey(row, columns) {
  return JSON.stringify(columns.map((c) => (isMissing(row[c]) ? null : String(row[c]).trim())));
}

export function findDuplicates(rows, columns) {
  const seen = new Map();
  const duplicates = [];
  rows.forEach((row, i) => {
    const k = rowKey(row, columns);
    if (seen.has(k)) duplicates.push({ index: i, firstIndex: seen.get(k) });
    else seen.set(k, i);
  });
  return duplicates;
}

export function analyzeQuality(rows, schema) {
  const columns = schema.columns.map((c) => c.name);
  const issues = [];
  const byColumn = {};
  const n = rows.length;

  if (n === 0) issues.push({ level: 'error', message: 'El conjunto de datos no contiene filas.' });
  if (columns.length === 0) issues.push({ level: 'error', message: 'No se detectaron columnas.' });

  let formulaCells = 0;
  for (const col of schema.columns) {
    const raw = rows.map((r) => r[col.name]);
    const missing = raw.filter(isMissing).length;
    let invalid = 0;
    const invalidExamples = [];
    const typed = [];
    for (const v of raw) {
      if (typeof v === 'string' && FORMULA_LIKE.test(v.trim()) && convertValue(v, 'numerico') === null) formulaCells++;
      if (isMissing(v)) { typed.push(null); continue; }
      const t = convertValue(v, col.type);
      if (t === null) {
        invalid++;
        if (invalidExamples.length < 3) invalidExamples.push(String(v).slice(0, 40));
      }
      typed.push(t);
    }
    const outliers = col.type === 'numerico' ? iqrOutliers(typed) : null;
    byColumn[col.name] = { missing, missingPct: n ? missing / n : 0, invalid, invalidExamples, outliers };

    if (n && missing === n) issues.push({ level: 'warning', column: col.name, message: `La columna «${col.name}» está completamente vacía.` });
    else if (missing > 0) issues.push({ level: missing / n > 0.2 ? 'warning' : 'info', column: col.name, message: `«${col.name}» tiene ${missing} valor(es) vacío(s) (${((missing / n) * 100).toFixed(1)} %).` });
    if (invalid > 0) issues.push({ level: 'warning', column: col.name, message: `«${col.name}» (${TYPE_LABELS[col.type]}) tiene ${invalid} valor(es) que no coinciden con el tipo detectado, p. ej.: ${invalidExamples.map((e) => `"${e}"`).join(', ')}.` });
    if (outliers && outliers.count > 0) issues.push({ level: 'info', column: col.name, message: `«${col.name}» tiene ${outliers.count} posible(s) valor(es) atípico(s) fuera de [${round(outliers.lower)}, ${round(outliers.upper)}] (regla 1,5·IQR).` });
  }

  const duplicates = findDuplicates(rows, columns);
  if (duplicates.length) issues.push({ level: 'warning', message: `Se encontraron ${duplicates.length} fila(s) duplicada(s) exacta(s).` });
  if (formulaCells) issues.push({ level: 'warning', message: `${formulaCells} celda(s) comienzan con =, +, - o @ y podrían ser fórmulas. Se tratan solo como texto y nunca se ejecutan.` });
  if (n > 0 && n < 5) issues.push({ level: 'info', message: 'Hay muy pocas filas; varios análisis estadísticos no serán concluyentes.' });

  const status = issues.some((i) => i.level === 'error') ? 'con_errores' : issues.some((i) => i.level === 'warning') ? 'con_advertencias' : 'valido';
  return { status, rowCount: n, columnCount: columns.length, duplicateCount: duplicates.length, formulaCells, byColumn, issues };
}

function round(v) {
  return v === null || v === undefined ? '—' : Math.round(v * 100) / 100;
}

export const STATUS_LABELS = {
  valido: 'Válido',
  con_advertencias: 'Con advertencias',
  con_errores: 'Con errores',
};
