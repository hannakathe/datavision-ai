// Dashboard dinámico: pestañas, KPI, gráficas configurables, filtros, desglose de registros y análisis inteligente.
import { api } from '../api.js';
import { h, clear, icon, toast, dialog, confirmAction, promptText, loading, emptyState, badge, dataTable } from '../ui.js';
import { loadDataset, dashboards, setLastDataset, lastDatasetId } from '../state.js';
import { applyFilters, activeFilters, distinctLabels, OPS, GRAINS, labelOf } from '../core/data.js';
import { suggestDashboard, computeChart, computeKpi, validateChart, sanitizeConfig, CHART_TYPES, PAGES, KPI_OPS, autoTitle } from '../core/dashboard.js';
import { generateInsights, keyFactors, INSIGHT_CATEGORIES } from '../core/insights.js';
import { TYPE_LABELS } from '../core/types.js';
import { fmtNumber, fmtDate } from '../core/format.js';
import { min as minOf, max as maxOf } from '../core/stats.js';
import { renderChart, sparkline } from '../charts.js';
import { recordsView } from './records.js';

const TABS = { ...PAGES, registros: 'Registros', analisis: 'Análisis inteligente' };
let charts = [];

export function destroyCharts() {
  for (const c of charts) c.destroy();
  charts = [];
}

export async function dashboardView(main, params, { tab } = {}) {
  destroyCharts();
  clear(main, loading('Preparando el dashboard…'));
  const list = await api.datasets();
  if (!list.length) {
    clear(main, emptyState('Aún no hay conjuntos de datos', 'Importa un archivo, crea una tabla manual o carga los datos de demostración para generar tu primer dashboard.',
      h('a', { class: 'btn btn-primary', href: '#/importar' }, 'Importar datos'), h('a', { class: 'btn btn-ghost', href: '#/' }, 'Ir al inicio')));
    return;
  }
  let id = Number(params.id) || lastDatasetId();
  if (!list.some((d) => d.id === id)) id = list[0].id;
  if (Number(params.id) !== id) { history.replaceState(null, '', `#/${tab === 'analisis' ? 'analisis' : 'dashboard'}/${id}`); }
  setLastDataset(id);

  const { meta, prep } = await loadDataset(id);
  let st = dashboards.get(id);
  if (!st) {
    st = { config: suggestDashboard(meta.schema, prep), tab: 'resumen', savedId: null, savedName: null, drill: null, filtersOpen: false };
    st.config.search = '';
    dashboards.set(id, st);
  }
  if (tab) st.tab = tab;
  const dateColumn = meta.schema.columns.find((c) => c.type === 'fecha' && c.present > 0)?.name;
  const saved = await api.dashboards(id).catch(() => []);

  // ---------- Estructura ----------
  const datasetSelect = h('select', { class: 'input', id: 'ds-select', onchange: (e) => { location.hash = `#/dashboard/${e.target.value}`; } },
    list.map((d) => h('option', { value: d.id, selected: d.id === id }, d.name)));
  const savedSelect = h('select', { class: 'input', 'aria-label': 'Configuraciones guardadas', onchange: (e) => loadSaved(Number(e.target.value)) },
    h('option', { value: '' }, saved.length ? 'Configuraciones guardadas…' : 'Sin configuraciones guardadas'),
    saved.map((s) => h('option', { value: s.id, selected: s.id === st.savedId }, s.name)));

  const header = h('section', { class: 'dash-head' },
    h('div', { class: 'dash-title' },
      h('label', { class: 'field field-inline', for: 'ds-select' }, h('span', { class: 'eyebrow' }, 'Conjunto de datos'), datasetSelect),
      h('p', { class: 'muted small' }, `${fmtNumber(meta.rowCount)} filas · ${meta.columnCount} columnas · origen: ${meta.sourceType}`, meta.isDemo ? [' · ', badge('Datos ficticios de demostración', 'warn')] : null)),
    h('div', { class: 'dash-actions' },
      savedSelect,
      h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('save'), st.savedId ? 'Guardar cambios' : 'Guardar configuración'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: resetAuto, title: 'Volver a la propuesta automática' }, icon('refresh'), 'Automático'),
      st.savedId ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon', onclick: deleteSaved, 'aria-label': 'Eliminar configuración guardada', title: 'Eliminar configuración guardada' }, icon('trash')) : null,
    ));

  const tabsEl = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Páginas del dashboard' });
  const filterBar = h('div', { class: 'filter-bar' });
  const filterPanel = h('div', { class: 'filter-panel', id: 'filter-panel', hidden: !st.filtersOpen });
  const content = h('div', { class: 'dash-content', id: 'dash-panel', role: 'tabpanel' });
  clear(main, header, tabsEl, filterBar, filterPanel, content);

  function renderTabs() {
    clear(tabsEl, Object.entries(TABS).map(([key, label]) => h('button', {
      type: 'button', role: 'tab', class: `tab${st.tab === key ? ' active' : ''}`, 'aria-selected': String(st.tab === key), tabindex: st.tab === key ? '0' : '-1', 'aria-controls': 'dash-panel',
      onclick: () => { st.tab = key; renderTabs(); renderContent(); },
      onkeydown: (e) => {
        const keys = Object.keys(TABS);
        const i = keys.indexOf(key);
        const next = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : null;
        if (next) { st.tab = next; renderTabs(); renderContent(); tabsEl.querySelector('.active')?.focus(); }
      },
    }, key === 'analisis' ? [icon('spark'), label] : label)));
  }

  // ---------- Filtros ----------
  const filterable = meta.schema.columns.filter((c) => c.present > 0 && c.role !== 'identificador' && (c.type !== 'categoria' || c.unique <= 80));
  const getFilter = (col) => st.config.filters.find((f) => f.column === col);
  function setFilter(col, f) {
    st.config.filters = st.config.filters.filter((x) => x.column !== col);
    if (f) st.config.filters.push({ column: col, ...f });
    st.drill = null;
    renderFilterBar();
    renderContent();
  }
  let debounce;
  const later = (fn) => { clearTimeout(debounce); debounce = setTimeout(fn, 280); };

  function renderFilterBar() {
    const active = activeFilters(prep, st.config.filters);
    const chips = active.map((f) => h('span', { class: 'chip' }, chipText(f), h('button', { type: 'button', class: 'chip-x', 'aria-label': `Quitar filtro ${f.column}`, onclick: () => { setFilter(f.column, null); renderFilterPanel(); } }, icon('x'))));
    clear(filterBar,
      h('div', { class: 'search-box' }, icon('eye'), h('input', {
        type: 'search', class: 'input', placeholder: 'Buscar en todos los campos…', value: st.config.search || '', 'aria-label': 'Búsqueda global',
        oninput: (e) => later(() => { st.config.search = e.target.value; st.drill = null; renderContent(); }),
      })),
      h('button', { type: 'button', class: `btn btn-ghost${st.filtersOpen ? ' pressed' : ''}`, 'aria-expanded': String(st.filtersOpen), 'aria-controls': 'filter-panel', onclick: () => { st.filtersOpen = !st.filtersOpen; filterPanel.hidden = !st.filtersOpen; renderFilterBar(); if (st.filtersOpen) renderFilterPanel(); } },
        icon('filter'), `Filtros${active.length ? ` (${active.length})` : ''}`),
      chips,
      active.length ? h('button', { type: 'button', class: 'link-btn', onclick: () => { st.config.filters = []; renderFilterBar(); renderFilterPanel(); renderContent(); } }, 'Limpiar todo') : null);
  }

  function chipText(f) {
    const type = prep.colMap[f.column].type;
    if (f.op === 'in') return `${f.column}: ${f.values.length > 2 ? `${f.values.slice(0, 2).join(', ')} +${f.values.length - 2}` : f.values.join(', ')}`;
    if (f.op === 'contains') return `${f.column} contiene «${f.text}»`;
    const fmt = (v) => (type === 'fecha' ? fmtDate(Number(v)) : fmtNumber(Number(v)));
    const lo = f.min !== undefined && f.min !== '' && f.min !== null;
    const hi = f.max !== undefined && f.max !== '' && f.max !== null;
    return `${f.column}: ${lo ? fmt(f.min) : '…'} – ${hi ? fmt(f.max) : '…'}`;
  }

  function renderFilterPanel() {
    if (!st.filtersOpen) return;
    clear(filterPanel, h('div', { class: 'filter-grid' }, filterable.map((c) => filterControl(c))),
      h('p', { class: 'muted small' }, 'Los filtros se combinan (Y). Los indicadores, gráficas, registros y el análisis se recalculan automáticamente.'));
  }

  function filterControl(c) {
    const f = getFilter(c.name);
    const title = h('div', { class: 'filter-title' }, h('strong', {}, c.name), h('span', { class: 'muted small' }, TYPE_LABELS[c.type]));
    if (c.type === 'categoria' || c.type === 'booleano' || (c.type === 'numerico' && c.discrete)) {
      const opts = distinctLabels(prep, c.name, 80);
      const selected = new Set(f?.values || []);
      return h('fieldset', { class: 'filter-box' }, h('legend', { class: 'sr-only' }, c.name), title,
        h('div', { class: 'check-list' }, opts.map((o) => h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: selected.has(o.label), onchange: (e) => {
            if (e.target.checked) selected.add(o.label); else selected.delete(o.label);
            setFilter(c.name, selected.size ? { op: 'in', values: [...selected] } : null);
          } }), h('span', {}, o.label), h('span', { class: 'muted small' }, fmtNumber(o.count))))));
    }
    if (c.type === 'numerico' || c.type === 'fecha') {
      const isDate = c.type === 'fecha';
      const all = prep.cols[c.name];
      const lo = minOf(all);
      const hi = maxOf(all);
      const toInput = (v) => (v === undefined || v === null || v === '' ? '' : isDate ? fmtDate(Number(v)) : String(v));
      const parse = (s, end) => {
        if (s === '') return '';
        if (!isDate) return Number(s);
        const ts = Date.parse(`${s}T00:00:00Z`);
        return Number.isNaN(ts) ? '' : end ? ts + 864e5 - 1 : ts;
      };
      const minI = h('input', { type: isDate ? 'date' : 'number', class: 'input input-sm', 'aria-label': `${c.name} desde`, placeholder: isDate ? '' : `mín ${fmtNumber(lo)}`, value: toInput(f?.min) });
      const maxI = h('input', { type: isDate ? 'date' : 'number', class: 'input input-sm', 'aria-label': `${c.name} hasta`, placeholder: isDate ? '' : `máx ${fmtNumber(hi)}`, value: toInput(f?.max) });
      const update = () => later(() => {
        const mn = parse(minI.value, false);
        const mx = parse(maxI.value, true);
        setFilter(c.name, mn === '' && mx === '' ? null : { op: 'range', min: mn, max: mx });
      });
      minI.addEventListener('input', update);
      maxI.addEventListener('input', update);
      return h('div', { class: 'filter-box' }, title, h('div', { class: 'range' }, minI, h('span', { class: 'muted' }, '–'), maxI),
        h('p', { class: 'muted small' }, isDate ? `${fmtDate(lo)} → ${fmtDate(hi)}` : `Rango: ${fmtNumber(lo)} – ${fmtNumber(hi)}`));
    }
    const input = h('input', { type: 'text', class: 'input input-sm', placeholder: 'Contiene…', value: f?.text || '', 'aria-label': `${c.name} contiene`,
      oninput: (e) => later(() => setFilter(c.name, e.target.value.trim() ? { op: 'contains', text: e.target.value } : null)) });
    return h('div', { class: 'filter-box' }, title, input);
  }

  // ---------- Contenido ----------
  function currentIdx() {
    return applyFilters(prep, st.config.filters, st.config.search);
  }

  function renderContent() {
    destroyCharts();
    const idx = currentIdx();
    clear(content);
    if (st.tab === 'registros') return renderRecords(idx);
    if (st.tab === 'analisis') return renderInsights(idx);
    const pageCharts = st.config.charts.filter((c) => c.page === st.tab);
    if (st.tab === 'resumen') {
      content.append(renderKpis(idx));
      const [lead, ...rest] = pageCharts;
      const top = h('div', { class: 'grid-lead' });
      if (lead) top.append(chartCard(lead, idx, true));
      else top.append(h('div', { class: 'card card-empty' }, h('p', {}, 'No hay gráfica principal. Añade una con «Añadir gráfica».')));
      top.append(factorsPanel(idx));
      content.append(top, chartGrid(rest, idx));
    } else {
      content.append(chartGrid(pageCharts, idx));
    }
  }

  function chartGrid(list, idx) {
    const grid = h('div', { class: 'grid-charts' });
    for (const spec of list) grid.append(chartCard(spec, idx));
    grid.append(h('button', { type: 'button', class: 'card add-card', onclick: () => editChart(null) }, icon('plus'), h('span', {}, 'Añadir gráfica'), h('span', { class: 'muted small' }, `en «${TABS[st.tab]}»`)));
    if (!list.length && st.tab !== 'resumen') {
      grid.prepend(h('div', { class: 'card card-empty' }, h('p', {}, st.tab === 'tendencias' && !dateColumn
        ? 'Este conjunto no tiene columnas de fecha válidas, por lo que no se proponen tendencias temporales.'
        : st.tab === 'relaciones' ? 'Se necesitan al menos dos columnas numéricas para analizar relaciones.' : 'No hay gráficas en esta página.')));
    }
    return grid;
  }

  function renderKpis(idx) {
    const row = h('div', { class: 'kpi-row' });
    for (const spec of st.config.kpis) {
      const k = computeKpi(prep, idx, spec, dateColumn);
      row.append(h('article', { class: 'card kpi' },
        h('div', { class: 'kpi-label' }, k.label),
        h('div', { class: `kpi-value${k.small ? ' kpi-value-sm' : ''}` }, k.display),
        k.delta ? h('div', { class: `kpi-delta ${k.delta.pct >= 0 ? 'up' : 'down'}` }, k.delta.text) : null,
        h('div', { class: 'kpi-sub' }, k.sub),
        k.spark ? sparkline(k.spark) : null));
    }
    row.append(h('button', { type: 'button', class: 'kpi-config', onclick: editKpis, 'aria-label': 'Configurar indicadores', title: 'Configurar indicadores' }, icon('edit')));
    return row;
  }

  function factorsPanel(idx) {
    const { basis, factors } = keyFactors(prep, idx);
    const card = h('aside', { class: 'card factors' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Factores destacados'), h('button', { type: 'button', class: 'link-btn', onclick: () => { st.tab = 'analisis'; renderTabs(); renderContent(); } }, 'Ver análisis →')),
      basis ? h('p', { class: 'muted small' }, `Categoría principal de cada dimensión según su ${basis}.`) : null);
    if (!factors.length) {
      card.append(h('p', { class: 'empty-inline' }, 'No hay dimensiones categóricas o datos suficientes para destacar factores.'));
      return card;
    }
    const list = h('ul', { class: 'factor-list' });
    for (const f of factors) {
      const size = 34 + Math.round(f.value * 26);
      list.append(h('li', { class: 'factor' },
        h('span', { class: 'factor-label' }, f.label, h('span', { class: 'muted small' }, f.detail)),
        h('span', { class: 'factor-bar', 'aria-hidden': 'true' }, h('span', { style: `width:${Math.max(6, f.value * 100)}%` })),
        h('span', { class: `factor-bubble ${f.kind}`, style: `width:${size}px;height:${size}px` }, f.text)));
    }
    card.append(list, h('p', { class: 'muted tiny' }, 'Participaciones descriptivas y correlaciones; no implican causalidad.'));
    return card;
  }

  function chartCard(spec, idx, lead = false) {
    const result = computeChart(prep, idx, spec);
    const card = h('article', { class: `card chart-card${lead ? ' lead' : ''}` });
    let showTable = false;
    const bodyEl = h('div', { class: 'chart-body' });
    const tableBtn = h('button', { type: 'button', class: 'btn-icon-sm', 'aria-pressed': 'false', title: 'Ver como tabla', 'aria-label': 'Ver datos como tabla', onclick: () => { showTable = !showTable; tableBtn.setAttribute('aria-pressed', String(showTable)); draw(); } }, icon('table'));
    card.append(h('div', { class: 'card-head' },
      h('div', {}, h('h3', {}, result.title), h('span', { class: 'muted tiny' }, CHART_TYPES[spec.type])),
      h('div', { class: 'card-tools' },
        tableBtn,
        h('button', { type: 'button', class: 'btn-icon-sm', title: 'Ver registros que respaldan la gráfica', 'aria-label': 'Ver registros que respaldan la gráfica', onclick: () => { st.drill = null; st.tab = 'registros'; renderTabs(); renderContent(); } }, icon('eye')),
        h('button', { type: 'button', class: 'btn-icon-sm', title: 'Configurar gráfica', 'aria-label': 'Configurar gráfica', onclick: () => editChart(spec) }, icon('gear')),
        h('button', { type: 'button', class: 'btn-icon-sm', title: 'Quitar gráfica', 'aria-label': 'Quitar gráfica', onclick: () => { st.config.charts = st.config.charts.filter((c) => c !== spec); renderContent(); } }, icon('x')))),
    bodyEl);
    if (result.notes?.length) card.append(h('ul', { class: 'chart-notes' }, result.notes.map((n) => h('li', {}, n))));

    function draw() {
      if (result.error) return clear(bodyEl, h('div', { class: 'chart-msg warn', role: 'note' }, icon('info'), result.error));
      if (result.empty) return clear(bodyEl, h('div', { class: 'chart-msg' }, icon('info'), result.empty));
      if (showTable) {
        const rows = result.chartType === 'scatter'
          ? result.points.slice(0, 200).map((p) => ({ [result.xLabel]: fmtNumber(p.x), [result.yLabel]: fmtNumber(p.y) }))
          : result.labels.map((l, i) => Object.fromEntries([['Grupo', l], ...result.datasets.map((d) => [d.label, d.data[i] === null ? '' : fmtNumber(d.data[i])])]));
        return clear(bodyEl, dataTable(Object.keys(rows[0] || {}), rows, { caption: result.title }));
      }
      const canvas = h('canvas', { role: 'img', 'aria-label': `${result.title}. Usa el botón de tabla para leer los valores.` });
      clear(bodyEl, h('div', { class: `chart-box${lead ? ' tall' : ''}` }, canvas));
      requestAnimationFrame(() => {
        if (!canvas.isConnected) return;
        charts.push(renderChart(canvas, result, { onDrill: (filter, label) => { st.drill = { filter, label, title: result.title }; st.tab = 'registros'; renderTabs(); renderContent(); tabsEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
      });
    }
    draw();
    if (result.drill && !result.error && !result.empty) card.append(h('p', { class: 'muted tiny hint' }, 'Haz clic en un elemento para ver sus registros.'));
    return card;
  }

  function renderRecords(idx) {
    let base = idx;
    let chip = null;
    if (st.drill) {
      const sub = new Set(applyFilters(prep, [st.drill.filter]));
      base = idx.filter((i) => sub.has(i));
      chip = h('div', { class: 'drill' }, h('span', {}, 'Registros que respaldan ', h('strong', {}, `«${st.drill.label}»`), ` en «${st.drill.title}»`),
        h('button', { type: 'button', class: 'link-btn', onclick: () => { st.drill = null; renderContent(); } }, 'Ver todos'));
    }
    content.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', {}, 'Registros filtrados')), chip,
      recordsView(prep, base, { searchable: true, caption: 'Registros del dashboard' })));
  }

  function renderInsights(idx) {
    const items = generateInsights(prep, idx, meta.validation);
    const nFilters = activeFilters(prep, st.config.filters).length + (st.config.search ? 1 : 0);
    content.append(h('div', { class: 'notice' }, icon('info'),
      h('p', {}, h('strong', {}, 'Análisis estadístico basado en reglas. '),
        'Las conclusiones se calculan localmente con estadística descriptiva (frecuencias, promedios, regresión lineal, correlación de Pearson, regla IQR). No se usa IA generativa ni se envían datos a servicios externos. Cada conclusión indica el cálculo que la respalda.',
        nFilters ? ` Se aplican ${nFilters} filtro(s) activos.` : '')));
    const groups = new Map();
    for (const it of items) { if (!groups.has(it.category)) groups.set(it.category, []); groups.get(it.category).push(it); }
    const grid = h('div', { class: 'insight-grid' });
    for (const [cat, list] of groups) {
      grid.append(h('section', { class: 'card insight-group' }, h('h3', {}, INSIGHT_CATEGORIES[cat] || cat),
        list.map((it) => h('article', { class: `insight ${it.level}` },
          h('h4', {}, it.level === 'warning' ? '⚠ ' : '', it.title),
          h('p', {}, it.text),
          h('p', { class: 'evidence' }, h('span', { class: 'evidence-tag' }, 'Respaldo'), it.evidence)))));
    }
    content.append(grid);
  }

  // ---------- Configuración ----------
  async function editChart(spec) {
    const isNew = !spec;
    const draft = spec ? { ...spec } : { id: `g${Date.now().toString(36)}`, page: st.tab in PAGES ? st.tab : 'resumen', type: 'bar', x: '', y: null, op: 'count', grain: 'auto', limit: 15, trend: true, title: '' };
    const cols = meta.schema.columns;
    const colOptions = (sel, allowEmpty) => [allowEmpty ? h('option', { value: '' }, '— Ninguna —') : null, ...cols.map((c) => h('option', { value: c.name, selected: c.name === sel }, `${c.name} (${TYPE_LABELS[c.type]})`))];
    const f = {
      title: h('input', { class: 'input', value: draft.title, placeholder: 'Automático', maxlength: 120 }),
      type: h('select', { class: 'input' }, Object.entries(CHART_TYPES).map(([k, v]) => h('option', { value: k, selected: k === draft.type }, v))),
      x: h('select', { class: 'input' }, h('option', { value: '' }, 'Selecciona…'), colOptions(draft.x, false)),
      op: h('select', { class: 'input' }, Object.entries(OPS).map(([k, v]) => h('option', { value: k, selected: k === draft.op }, v))),
      y: h('select', { class: 'input' }, colOptions(draft.y, true)),
      grain: h('select', { class: 'input' }, h('option', { value: 'auto' }, 'Automática'), Object.entries(GRAINS).map(([k, v]) => h('option', { value: k, selected: k === draft.grain }, v))),
      limit: h('input', { class: 'input', type: 'number', min: 0, max: 50, value: draft.limit }),
      page: h('select', { class: 'input' }, Object.entries(PAGES).map(([k, v]) => h('option', { value: k, selected: k === draft.page }, v))),
    };
    const msg = h('div', { class: 'form-msg', 'aria-live': 'polite' });
    const read = () => ({ ...draft, title: f.title.value.trim(), type: f.type.value, x: f.x.value, op: f.op.value, y: f.y.value || null, grain: f.grain.value, limit: Number(f.limit.value) || 0, page: f.page.value });
    const check = () => {
      const d = read();
      const v = validateChart(d, meta.schema);
      clear(msg, v.errors.map((e) => h('p', { class: 'err' }, e)), v.warnings.map((w) => h('p', { class: 'warn' }, w)), v.ok ? h('p', { class: 'ok' }, `Vista: «${d.title || autoTitle(d)}»`) : null);
      return v.ok;
    };
    Object.values(f).forEach((el) => el.addEventListener('change', check));
    const field = (label, el, hint) => h('label', { class: 'field' }, h('span', {}, label), el, hint ? h('small', { class: 'muted' }, hint) : null);
    const body = h('div', { class: 'form-grid' },
      field('Tipo de gráfica', f.type),
      field('Columna a analizar (eje X / dimensión)', f.x, 'Categorías o fechas para barras, líneas y sectores; numérica para histograma y dispersión.'),
      field('Operación estadística', f.op),
      field('Variable numérica (Y)', f.y, 'Necesaria para suma, promedio, mínimo, máximo y mediana, y para dispersión.'),
      field('Agrupación temporal', f.grain, 'Solo aplica si X es una fecha.'),
      field('Máximo de grupos', f.limit, '0 = sin límite; el resto se agrupa en «Otros».'),
      field('Página', f.page),
      field('Título', f.title),
      msg);
    setTimeout(check, 0);
    const res = await dialog({ title: isNew ? 'Añadir gráfica' : 'Configurar gráfica', body, actions: [{ label: isNew ? 'Añadir' : 'Aplicar', value: 'ok', primary: true }] });
    if (res !== 'ok') return;
    const d = read();
    const v = validateChart(d, meta.schema);
    if (!v.ok) { toast(v.errors[0], 'error'); return editChart(d.x ? d : spec); }
    if (isNew) st.config.charts.push(d);
    else Object.assign(spec, d);
    if (d.page !== st.tab) { st.tab = d.page; renderTabs(); toast(`Gráfica ubicada en «${PAGES[d.page]}».`); }
    renderContent();
  }

  async function editKpis() {
    const draft = st.config.kpis.map((k) => ({ ...k }));
    const listEl = h('div', { class: 'kpi-edit' });
    const renderList = () => clear(listEl, draft.map((k, i) => h('div', { class: 'kpi-edit-row' },
      h('select', { class: 'input', 'aria-label': `Operación del indicador ${i + 1}`, onchange: (e) => { k.op = e.target.value; if (k.op === 'count') k.column = null; renderList(); } },
        Object.entries(KPI_OPS).map(([op, label]) => h('option', { value: op, selected: op === k.op }, label))),
      h('select', { class: 'input', 'aria-label': `Columna del indicador ${i + 1}`, disabled: k.op === 'count', onchange: (e) => { k.column = e.target.value || null; } },
        h('option', { value: '' }, '—'), meta.schema.columns.filter((c) => kpiCompatible(k.op, c)).map((c) => h('option', { value: c.name, selected: c.name === k.column }, c.name))),
      h('button', { type: 'button', class: 'btn-icon-sm', 'aria-label': 'Quitar indicador', onclick: () => { draft.splice(i, 1); renderList(); } }, icon('x')))),
    draft.length < 6 ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { draft.push({ id: `k${Date.now().toString(36)}`, op: 'count', column: null }); renderList(); } }, icon('plus'), 'Añadir indicador') : null);
    renderList();
    const res = await dialog({ title: 'Indicadores (KPI)', body: h('div', {}, h('p', { class: 'muted small' }, 'Elige la operación y la columna. Solo se listan columnas compatibles con cada operación.'), listEl), actions: [{ label: 'Aplicar', value: 'ok', primary: true }] });
    if (res !== 'ok') return;
    st.config.kpis = draft.filter((k) => k.op === 'count' || k.column);
    renderContent();
  }

  function kpiCompatible(op, c) {
    if (op === 'count') return false;
    if (op === 'distinct') return true;
    if (op === 'pct_true') return c.type === 'booleano';
    if (op === 'range') return c.type === 'fecha';
    return c.type === 'numerico';
  }

  async function save() {
    const config = sanitizeConfig(st.config, meta.schema);
    try {
      if (st.savedId) {
        await api.updateDashboard(st.savedId, { config });
        toast(`Configuración «${st.savedName}» actualizada.`, 'success');
      } else {
        const name = await promptText('Guardar configuración', 'Nombre de la configuración', `Dashboard de ${meta.name}`.slice(0, 120));
        if (!name) return;
        const d = await api.saveDashboard(id, { name, config });
        st.savedId = d.id;
        st.savedName = d.name;
        toast(`Configuración «${d.name}» guardada.`, 'success');
      }
      dashboardView(main, { id }, {});
    } catch (e) { toast(e.message, 'error'); }
  }

  function loadSaved(dashId) {
    const d = saved.find((s) => s.id === dashId);
    if (!d) return;
    st.config = { ...sanitizeConfig(d.config, meta.schema) };
    const lost = (d.config.charts?.length || 0) - st.config.charts.length;
    st.savedId = d.id;
    st.savedName = d.name;
    st.drill = null;
    toast(`Configuración «${d.name}» cargada.${lost > 0 ? ` ${lost} gráfica(s) se omitieron porque sus columnas ya no existen.` : ''}`, lost > 0 ? 'warn' : 'success');
    dashboardView(main, { id }, {});
  }

  async function deleteSaved() {
    if (!(await confirmAction('Eliminar configuración', `¿Eliminar la configuración guardada «${st.savedName}»? Los datos no se modifican.`))) return;
    await api.deleteDashboard(st.savedId);
    st.savedId = null;
    st.savedName = null;
    toast('Configuración eliminada.', 'success');
    dashboardView(main, { id }, {});
  }

  function resetAuto() {
    st.config = { ...suggestDashboard(meta.schema, prep), search: '' };
    st.savedId = null;
    st.savedName = null;
    st.drill = null;
    toast('Se restableció la propuesta automática.');
    dashboardView(main, { id }, {});
  }

  renderTabs();
  renderFilterBar();
  renderFilterPanel();
  renderContent();
}

export { labelOf };
