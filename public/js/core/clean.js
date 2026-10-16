// Correcciones opcionales elegidas por el usuario: duplicados y valores faltantes. Nunca se aplican solas.
import { badRequest } from './errors.js';
import { isMissing, convertValue } from './types.js';
import { rowKey } from './quality.js';
import { mean, median } from './stats.js';

const text = (v, max) => String(v ?? '').trim().slice(0, max);

export const MISSING_STRATEGIES = ['drop', 'fill_value', 'fill_mean', 'fill_median', 'fill_mode'];

export function cleanRows(rows, schema, { removeDuplicates = false, missing = [] } = {}) {
  let out = rows.map((r) => ({ ...r }));
  const report = [];
  const columns = schema.columns.map((c) => c.name);
  if (removeDuplicates) {
    const seen = new Set();
    const before = out.length;
    out = out.filter((r) => { const k = rowKey(r, columns); if (seen.has(k)) return false; seen.add(k); return true; });
    report.push(`Se eliminaron ${before - out.length} fila(s) duplicada(s).`);
  }
  if (!Array.isArray(missing)) throw badRequest('missing debe ser una lista de reglas.');
  for (const rule of missing) {
    const col = schema.columns.find((c) => c.name === rule?.column);
    if (!col) throw badRequest(`La columna «${rule?.column}» no existe.`);
    if (!MISSING_STRATEGIES.includes(rule.strategy)) throw badRequest(`Estrategia no válida para «${col.name}».`);
    const name = col.name;
    const missingCount = out.filter((r) => isMissing(r[name])).length;
    if (!missingCount) continue;
    if (rule.strategy === 'drop') {
      out = out.filter((r) => !isMissing(r[name]));
      report.push(`«${name}»: se eliminaron ${missingCount} fila(s) con valor vacío.`);
      continue;
    }
    let fill;
    if (rule.strategy === 'fill_value') {
      fill = text(String(rule.value ?? ''), 200, 'valor');
      if (!fill) throw badRequest(`Indica el valor de reemplazo para «${name}».`);
    } else if (rule.strategy === 'fill_mode') {
      const counts = new Map();
      for (const r of out) if (!isMissing(r[name])) counts.set(r[name], (counts.get(r[name]) || 0) + 1);
      fill = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    } else {
      if (col.type !== 'numerico') throw badRequest(`«${name}» no es numérica: no se puede usar promedio ni mediana.`);
      const nums = out.map((r) => convertValue(r[name], 'numerico'));
      const v = rule.strategy === 'fill_mean' ? mean(nums) : median(nums);
      fill = v === null ? undefined : Math.round(v * 10000) / 10000;
    }
    if (fill === undefined) throw badRequest(`No hay valores en «${name}» para calcular el reemplazo.`);
    for (const r of out) if (isMissing(r[name])) r[name] = fill;
    report.push(`«${name}»: ${missingCount} valor(es) vacío(s) reemplazado(s) por ${JSON.stringify(fill)}.`);
  }
  return { rows: out, report };
}
