// Análisis inteligente basado en reglas estadísticas interpretables (no usa IA generativa ni servicios externos).
import { groupBy, labelOf, chooseGrain, EMPTY_LABEL } from './data.js';
import { describe, pearson, linearTrend, iqrOutliers, min as minOf, max as maxOf } from './stats.js';
import { profileSchema, isAdditive, defaultOp } from './dashboard.js';
import { fmtNumber, fmtPct } from './format.js';

export const INSIGHT_CATEGORIES = {
  resumen: 'Resumen',
  limitacion: 'Limitaciones',
  categorias: 'Categorías y concentración',
  tiempo: 'Variación temporal',
  correlacion: 'Correlaciones',
  atipicos: 'Valores atípicos',
  distribucion: 'Distribuciones',
  comparacion: 'Comparación entre grupos',
  calidad: 'Calidad de datos',
};

const dec = (v, d = 2) => v.toFixed(d).replace('.', ',');

function strength(r) {
  const a = Math.abs(r);
  if (a >= 0.8) return 'muy fuerte';
  if (a >= 0.6) return 'fuerte';
  return 'moderada';
}

export function generateInsights(prep, idx, validation) {
  const out = [];
  const push = (category, title, text, evidence, level = 'info') => out.push({ category, title, text, evidence, level });
  const n = idx.length;
  const { measures, dates, dims } = profileSchema(prep.schema);
  const vals = (col) => idx.map((i) => prep.cols[col][i]);

  push('resumen', 'Alcance del análisis',
    `Se analizan ${fmtNumber(n)} registro(s) y ${prep.schema.columns.length} columna(s): ${measures.length} numérica(s) analizable(s), ${dims.length} dimensión(es) categórica(s) y ${dates.length} de fecha.`,
    'Detección automática de tipos de columna y filtros activos del dashboard.');

  if (n === 0) {
    push('limitacion', 'Sin registros', 'No hay registros con los filtros actuales; no es posible extraer conclusiones.', 'Recuento de filas filtradas = 0.', 'warning');
    return out;
  }
  if (n < 5) {
    push('limitacion', 'Datos insuficientes', 'Hay menos de 5 registros: cualquier patrón observado puede deberse al azar. Las conclusiones siguientes son solo descriptivas.', `n = ${n}.`, 'warning');
  }
  if (!measures.length) {
    push('limitacion', 'Sin variables numéricas', 'No se detectaron columnas numéricas; no se calculan sumas, promedios ni correlaciones. El análisis se limita a frecuencias.', 'Esquema detectado.', 'info');
  }

  // Distribuciones de las medidas principales
  for (const m of measures.slice(0, 3)) {
    const d = describe(vals(m.name));
    if (d.n < 2) continue;
    let shape = '';
    if (d.std && d.mean !== null && d.median !== null && Math.abs(d.mean - d.median) > 0.25 * d.std) {
      shape = d.mean > d.median
        ? ' El promedio supera claramente a la mediana: la distribución está sesgada hacia valores altos (unos pocos registros elevan el promedio).'
        : ' El promedio es claramente menor que la mediana: algunos valores bajos arrastran el promedio.';
    }
    push('distribucion', `Distribución de «${m.name}»`,
      `Promedio ${fmtNumber(d.mean)}, mediana ${fmtNumber(d.median)}, rango de ${fmtNumber(d.min)} a ${fmtNumber(d.max)}.${shape}`,
      `n = ${d.n}; desviación estándar = ${fmtNumber(d.std)}; Q1 = ${fmtNumber(d.q1)}; Q3 = ${fmtNumber(d.q3)}.`);
  }

  // Categorías principales y concentración
  const M = measures[0];
  const additiveM = M && isAdditive(M.name) ? M : null;
  for (const dim of dims.slice(0, 3)) {
    const g = groupBy(prep, idx, { dimension: dim.name, op: 'count' });
    const real = g.labels.map((l, i) => [l, g.values[i]]).filter(([l]) => l !== EMPTY_LABEL);
    if (real.length < 2) continue;
    const [topL, topC] = real[0];
    let text = `«${topL}» es el valor más frecuente de «${dim.name}» con ${fmtNumber(topC)} registros (${fmtPct(topC / n)}).`;
    let evidence = `Frecuencias: ${real.slice(0, 5).map(([l, c]) => `${l}: ${c}`).join(' · ')}${real.length > 5 ? ` · … (${real.length} grupos)` : ''}.`;
    if (additiveM) {
      const gs = groupBy(prep, idx, { dimension: dim.name, measure: additiveM.name, op: 'sum' });
      const total = gs.values.reduce((a, v) => a + (v || 0), 0);
      if (total > 0 && gs.values.every((v) => v === null || v >= 0)) {
        text += ` Por valor, «${gs.labels[0]}» concentra el ${fmtPct(gs.values[0] / total)} de la suma de «${additiveM.name}».`;
        if (gs.labels.length >= 6) {
          const top3 = gs.values.slice(0, 3).reduce((a, v) => a + (v || 0), 0) / total;
          if (top3 >= 0.6) text += ` Los 3 primeros grupos suman el ${fmtPct(top3)}: alta concentración.`;
        }
        evidence += ` Suma de «${additiveM.name}» por grupo: ${gs.labels.slice(0, 3).map((l, i) => `${l}: ${fmtNumber(gs.values[i])}`).join(' · ')}; total ${fmtNumber(total)}.`;
      }
    }
    push('categorias', `Composición por «${dim.name}»`, text, evidence);
  }

  // Comparación de promedios entre grupos
  if (dims[0] && M) {
    const g = groupBy(prep, idx, { dimension: dims[0].name, measure: M.name, op: 'avg' });
    const ok = g.labels.map((l, i) => ({ l, v: g.values[i], c: g.counts[i] })).filter((e) => e.l !== EMPTY_LABEL && e.v !== null && e.c >= 3);
    if (ok.length >= 2) {
      const hi = ok[0];
      const lo = ok[ok.length - 1];
      push('comparacion', `«${M.name}» según «${dims[0].name}»`,
        `El promedio de «${M.name}» es más alto en «${hi.l}» (${fmtNumber(hi.v)}) y más bajo en «${lo.l}» (${fmtNumber(lo.v)}). Es una diferencia descriptiva: no se ha aplicado una prueba de significancia estadística.`,
        `Promedios por grupo con al menos 3 registros: ${ok.slice(0, 6).map((e) => `${e.l}: ${fmtNumber(e.v)} (n=${e.c})`).join(' · ')}.`);
    }
  }

  // Variación temporal
  const D = dates[0];
  if (D) {
    const all = prep.cols[D.name];
    const lo = minOf(all);
    const hi = maxOf(all);
    if (lo !== null) {
      const grain = chooseGrain(lo, hi);
      const op = M ? defaultOp(M) : 'count';
      const g = groupBy(prep, idx, { dimension: D.name, measure: M ? M.name : null, op, grain });
      const series = g.labels.map((l, i) => ({ l, v: g.values[i], c: g.counts[i] })).filter((e) => e.l !== EMPTY_LABEL && e.v !== null);
      const what = M ? `${op === 'sum' ? 'la suma' : 'el promedio'} de «${M.name}»` : 'el número de registros';
      if (series.length < 3) {
        push('limitacion', 'Serie temporal corta', `Solo hay ${series.length} período(s) con datos en «${D.name}»; se necesitan al menos 3 para describir una tendencia.`, `Agrupación por ${grain}.`, 'info');
      } else {
        const first = series[0];
        const last = series[series.length - 1];
        const peak = series.reduce((a, b) => (b.v > a.v ? b : a));
        const lt = linearTrend(series.map((e) => e.v));
        const change = first.v ? (last.v - first.v) / Math.abs(first.v) : null;
        let text = `Entre ${first.l} y ${last.l}, ${what} pasó de ${fmtNumber(first.v)} a ${fmtNumber(last.v)}${change !== null ? ` (${change >= 0 ? '+' : '−'}${fmtPct(Math.abs(change))})` : ''}. El período más alto fue ${peak.l} (${fmtNumber(peak.v)}).`;
        if (lt) {
          text += lt.r2 >= 0.3
            ? ` La tendencia lineal es ${lt.slope > 0 ? 'creciente' : 'decreciente'} (≈ ${fmtNumber(lt.slope)} por período).`
            : ' No hay una tendencia lineal clara: la serie varía sin una dirección consistente.';
        }
        const medCount = [...series.map((e) => e.c)].sort((a, b) => a - b)[Math.floor(series.length / 2)];
        if (last.c < medCount * 0.5) text += ` Atención: ${last.l} tiene pocos registros (${last.c}) y podría estar incompleto.`;
        push('tiempo', `Evolución en el tiempo (${D.name})`, text,
          `Agregación por ${grain}; ${series.length} períodos; R² de la tendencia lineal = ${lt ? dec(lt.r2) : 'n/d'}.`);
      }
    }
  }

  // Correlaciones
  const ms = measures.slice(0, 8);
  if (ms.length >= 2) {
    const found = [];
    let tested = 0;
    for (let i = 0; i < ms.length; i++) {
      for (let j = i + 1; j < ms.length; j++) {
        const { r, n: pn } = pearson(vals(ms[i].name), vals(ms[j].name));
        if (r === null || pn < 10) continue;
        tested++;
        if (Math.abs(r) >= 0.5) found.push({ a: ms[i].name, b: ms[j].name, r, pn });
      }
    }
    found.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    for (const f of found.slice(0, 4)) {
      push('correlacion', `«${f.a}» y «${f.b}»`,
        `Existe una correlación ${strength(f.r)} ${f.r > 0 ? 'positiva' : 'negativa'}: cuando una ${f.r > 0 ? 'aumenta' : 'aumenta'}, la otra tiende a ${f.r > 0 ? 'aumentar' : 'disminuir'}. Esto indica asociación, no causalidad: puede haber otros factores o una relación indirecta.`,
        `Coeficiente de Pearson r = ${dec(f.r)} con n = ${f.pn} pares completos.`);
    }
    if (!found.length) {
      push('correlacion', 'Sin correlaciones lineales fuertes',
        tested ? `Ninguno de los ${tested} pares de variables numéricas presenta |r| ≥ 0,5.` : 'No hay suficientes pares completos (mínimo 10) para estimar correlaciones.',
        'Correlación de Pearson entre pares de columnas numéricas.');
    }
  }

  // Valores atípicos
  for (const m of measures.slice(0, 6)) {
    const o = iqrOutliers(vals(m.name));
    if (o.count > 0) {
      push('atipicos', `Posibles atípicos en «${m.name}»`,
        `${o.count} valor(es) quedan fuera del rango esperado [${fmtNumber(o.lower)}, ${fmtNumber(o.upper)}]. Revísalos antes de concluir: pueden ser errores de captura o casos excepcionales reales.`,
        `Regla 1,5·IQR (Q1 = ${fmtNumber(o.q1)}, Q3 = ${fmtNumber(o.q3)}); ejemplos: ${o.examples.map((e) => fmtNumber(e)).join(', ')}.`, 'warning');
    }
  }

  // Calidad
  if (validation) {
    const missingCols = Object.entries(validation.byColumn || {}).filter(([, c]) => c.missing > 0).sort((a, b) => b[1].missing - a[1].missing);
    if (missingCols.length) {
      push('calidad', 'Datos faltantes',
        `${missingCols.length} columna(s) tienen valores vacíos; la más afectada es «${missingCols[0][0]}» (${fmtPct(missingCols[0][1].missingPct)}). Los cálculos omiten esos valores.`,
        missingCols.slice(0, 5).map(([k, c]) => `${k}: ${c.missing}`).join(' · '), missingCols[0][1].missingPct > 0.2 ? 'warning' : 'info');
    }
    if (validation.duplicateCount) {
      push('calidad', 'Filas duplicadas', `Hay ${validation.duplicateCount} fila(s) idéntica(s) a otra; pueden inflar recuentos y sumas. Puedes eliminarlas desde la vista del conjunto de datos.`, 'Comparación exacta de todas las columnas.', 'warning');
    }
  }
  return out;
}

// Factores destacados: participación de la categoría principal de cada dimensión y correlación más fuerte con la medida principal.
export function keyFactors(prep, idx) {
  const { measures, dims } = profileSchema(prep.schema);
  const M = measures[0];
  const useSum = M && isAdditive(M.name);
  const factors = [];
  const n = idx.length;
  if (!n) return { basis: '', factors };
  for (const dim of dims.slice(0, 5)) {
    const g = groupBy(prep, idx, { dimension: dim.name, measure: useSum ? M.name : null, op: useSum ? 'sum' : 'count' });
    const pairs = g.labels.map((l, i) => [l, g.values[i]]).filter(([l, v]) => l !== EMPTY_LABEL && v !== null);
    const total = pairs.reduce((a, [, v]) => a + v, 0);
    if (pairs.length < 2 || total <= 0 || pairs.some(([, v]) => v < 0)) continue;
    factors.push({ kind: 'share', label: `${dim.name} es «${pairs[0][0]}»`, value: pairs[0][1] / total, text: fmtPct(pairs[0][1] / total, 0), detail: `${pairs.length} grupos` });
  }
  if (M) {
    let best = null;
    for (const o of measures.slice(1, 8)) {
      const { r, n: pn } = pearson(idx.map((i) => prep.cols[M.name][i]), idx.map((i) => prep.cols[o.name][i]));
      if (r !== null && pn >= 10 && (!best || Math.abs(r) > Math.abs(best.r))) best = { o: o.name, r };
    }
    if (best && Math.abs(best.r) >= 0.3) factors.push({ kind: 'corr', label: `${best.o} ↔ ${M.name}`, value: Math.abs(best.r), text: `r ${dec(best.r)}`, detail: 'correlación' });
  }
  factors.sort((a, b) => b.value - a.value);
  return { basis: useSum ? `participación en la suma de «${M.name}»` : 'participación en el número de registros', factors: factors.slice(0, 5) };
}

export { labelOf };
