// Renderizado con Chart.js de los resultados calculados por core/dashboard.js.
import { fmtNumber } from './core/format.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function seriesColors() {
  return [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--s${i}`));
}

function alpha(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function baseOptions(result) {
  const ink = css('--text-2');
  const grid = css('--grid');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { display: false, labels: { color: ink, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 12 } } },
      tooltip: {
        backgroundColor: css('--tooltip-bg'),
        titleColor: css('--tooltip-ink'),
        bodyColor: css('--tooltip-ink'),
        padding: 10,
        cornerRadius: 8,
        callbacks: {
          label: (ctx) => {
            if (result.chartType === 'scatter') return `${result.xLabel}: ${fmtNumber(ctx.raw.x)} · ${result.yLabel}: ${fmtNumber(ctx.raw.y)}`;
            const v = ctx.raw;
            const count = result.counts?.[ctx.dataIndex];
            return `${ctx.dataset.label}: ${fmtNumber(v)}${count !== undefined && ctx.datasetIndex === 0 && result.valueLabel !== 'Registros' ? ` (${fmtNumber(count)} registros)` : ''}`;
          },
        },
      },
    },
    scales: {
      x: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: ink, padding: 6, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } } },
      y: { grid: { color: grid, drawTicks: false }, border: { display: false }, ticks: { color: ink, padding: 6, font: { size: 11 }, callback: (v) => fmtNumber(v, { compact: true }) } },
    },
  };
}

export function renderChart(canvas, result, { onDrill } = {}) {
  const colors = seriesColors();
  const surface = css('--surface');
  const opts = baseOptions(result);
  let config;
  const t = result.chartType;

  if (t === 'scatter') {
    opts.interaction = { mode: 'nearest', intersect: true };
    opts.scales.x.type = 'linear';
    opts.scales.x.title = { display: true, text: result.xLabel, color: css('--text-2') };
    opts.scales.x.ticks.callback = (v) => fmtNumber(v, { compact: true });
    opts.scales.y.title = { display: true, text: result.yLabel, color: css('--text-2') };
    config = { type: 'scatter', data: { datasets: [{ label: `${result.yLabel} vs ${result.xLabel}`, data: result.points, backgroundColor: alpha(colors[0], 0.55), borderColor: surface, borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 }] }, options: opts };
  } else if (t === 'pie' || t === 'doughnut') {
    delete opts.scales;
    opts.plugins.legend.display = true;
    opts.plugins.legend.position = 'right';
    opts.interaction = { mode: 'nearest', intersect: true };
    config = {
      type: t,
      data: { labels: result.labels, datasets: [{ label: result.datasets[0].label, data: result.datasets[0].data, backgroundColor: result.labels.map((_, i) => colors[i % colors.length]), borderColor: surface, borderWidth: 2, hoverOffset: 6 }] },
      options: { ...opts, cutout: t === 'doughnut' ? '62%' : 0 },
    };
  } else if (t === 'line') {
    const main = colors[0];
    const ds = [{
      label: result.datasets[0].label,
      data: result.datasets[0].data,
      borderColor: main,
      backgroundColor: alpha(main, 0.1),
      fill: 'origin',
      cubicInterpolationMode: 'monotone',
      borderWidth: 2,
      pointRadius: result.labels.length > 40 ? 0 : 3,
      pointHoverRadius: 5,
      pointBackgroundColor: main,
      spanGaps: false,
    }];
    if (result.datasets[1]) {
      ds.push({ label: result.datasets[1].label, data: result.datasets[1].data, borderColor: css('--accent'), borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, tension: 0 });
      opts.plugins.legend.display = true;
      opts.plugins.legend.position = 'top';
      opts.plugins.legend.align = 'start';
    }
    // El área rellena se mide desde cero; con valores negativos el eje se ajusta solo.
    opts.scales.y.beginAtZero = true;
    opts.interaction = { mode: 'index', intersect: false };
    config = { type: 'line', data: { labels: result.labels, datasets: ds }, options: opts };
  } else {
    const horizontal = t === 'hbar';
    if (horizontal) {
      opts.indexAxis = 'y';
      opts.scales.x.ticks.callback = opts.scales.y.ticks.callback;
      delete opts.scales.y.ticks.callback;
      opts.scales.x.beginAtZero = true;
      opts.scales.y.grid.display = false;
    } else {
      opts.scales.x.grid.display = false;
      opts.scales.y.beginAtZero = true;
    }
    opts.interaction = { mode: 'nearest', intersect: true, axis: horizontal ? 'y' : 'x' };
    const isHist = t === 'histogram';
    config = {
      type: 'bar',
      data: {
        labels: result.labels,
        datasets: [{
          label: result.datasets[0].label,
          data: result.datasets[0].data,
          backgroundColor: result.labels.map((l) => (l === 'Otros' || l === '(vacío)' ? css('--muted-fill') : colors[0])),
          hoverBackgroundColor: css('--s1-strong'),
          borderRadius: isHist ? 2 : 4,
          borderSkipped: 'start',
          maxBarThickness: 34,
          categoryPercentage: isHist ? 1 : 0.8,
          barPercentage: isHist ? 0.97 : 0.85,
        }],
      },
      options: opts,
    };
  }

  if (onDrill && result.drill) {
    config.options.onClick = (_evt, els) => {
      if (els.length) onDrill(result.drill[els[0].index], result.labels[els[0].index]);
    };
    config.options.onHover = (evt, els) => { evt.native.target.style.cursor = els.length ? 'pointer' : 'default'; };
  }
  // eslint-disable-next-line no-undef
  return new Chart(canvas, config);
}

// Mini serie para tarjetas KPI (SVG, sin ejes).
export function sparkline(values) {
  const w = 120;
  const hgt = 36;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${hgt}`);
  svg.setAttribute('class', 'spark');
  svg.setAttribute('aria-hidden', 'true');
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values.map((v, i) => [values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 4) + 2, hi === lo ? hgt / 2 : hgt - 3 - ((v - lo) / (hi - lo)) * (hgt - 6)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = document.createElementNS(ns, 'path');
  area.setAttribute('d', `${d} L${pts[pts.length - 1][0].toFixed(1)},${hgt} L${pts[0][0].toFixed(1)},${hgt} Z`);
  area.setAttribute('class', 'spark-area');
  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', d);
  line.setAttribute('class', 'spark-line');
  const [lx, ly] = pts[pts.length - 1];
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', lx);
  dot.setAttribute('cy', ly);
  dot.setAttribute('r', 3);
  dot.setAttribute('class', 'spark-dot');
  svg.append(area, line, dot);
  return svg;
}
