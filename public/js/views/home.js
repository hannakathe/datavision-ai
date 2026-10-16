import { api } from '../api.js';
import { h, clear, icon, toast, badge, loading } from '../ui.js';
import { STATUS_LABELS } from '../core/quality.js';
import { fmtNumber, fmtDateTime } from '../core/format.js';
import { statusKind } from './datasets.js';

export async function homeView(main) {
  clear(main, loading());
  const list = await api.datasets();
  const steps = [
    ['upload', '1. Carga', 'Importa CSV, JSON, Excel o SQLite, pega datos o créalos en el editor manual.'],
    ['table', '2. Valida', 'Se detectan tipos, vacíos, duplicados, atípicos y fórmulas. Tú decides qué corregir.'],
    ['chart', '3. Explora', 'El dashboard se genera según las columnas disponibles: KPI, gráficas y filtros.'],
    ['spark', '4. Interpreta', 'El análisis inteligente explica patrones con el cálculo que los respalda.'],
  ];
  const hasDemo = list.some((d) => d.isDemo);
  clear(main,
    h('section', { class: 'hero card' },
      h('div', {},
        h('p', { class: 'eyebrow' }, 'Taller: IA en el mundo empresarial'),
        h('h2', { class: 'hero-title' }, 'Convierte cualquier conjunto de datos en un dashboard inteligente'),
        h('p', { class: 'hero-text' }, 'DataVision AI no es un tablero fijo de ventas: identifica las columnas de tus datos (ventas, inventario, talento humano, finanzas, encuestas o cualquier otro tema), calcula indicadores pertinentes y propone visualizaciones adecuadas.'),
        h('div', { class: 'hero-actions' },
          h('a', { class: 'btn btn-primary', href: '#/importar' }, icon('upload'), 'Importar datos'),
          h('a', { class: 'btn btn-ghost', href: '#/editor' }, icon('edit'), 'Crear tabla manual'),
          list.length ? h('a', { class: 'btn btn-ghost', href: '#/dashboard' }, icon('chart'), 'Abrir dashboard') : null)),
      h('div', { class: 'hero-stats' },
        stat(fmtNumber(list.length), 'conjuntos de datos'),
        stat(fmtNumber(list.reduce((a, d) => a + d.rowCount, 0)), 'registros almacenados'),
        stat('SQLite', 'persistencia local'))),
    h('section', { class: 'steps' }, steps.map(([ic, t, d]) => h('article', { class: 'card step' }, h('span', { class: 'step-icon' }, icon(ic)), h('h3', {}, t), h('p', { class: 'muted' }, d)))),
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Conjuntos recientes'), h('a', { class: 'link-btn', href: '#/conjuntos' }, 'Gestionar todos →')),
      list.length
        ? h('ul', { class: 'recent' }, list.slice(0, 6).map((d) => h('li', {},
          h('a', { href: `#/dashboard/${d.id}`, class: 'recent-link' }, h('strong', {}, d.name), h('span', { class: 'muted small' }, `${fmtNumber(d.rowCount)} filas · ${d.columnCount} col. · ${fmtDateTime(d.updatedAt)}`)),
          badge(STATUS_LABELS[d.status], statusKind(d.status)))))
        : h('p', { class: 'empty-inline' }, 'Todavía no hay datos. Importa un archivo o carga los ejemplos.'),
      !hasDemo ? h('div', { class: 'demo-box' },
        h('p', {}, h('strong', {}, 'Datos de demostración: '), 'cinco conjuntos ficticios (ventas, inventario, recursos humanos, finanzas y una encuesta) para probar el sistema. Puedes eliminarlos cuando quieras.'),
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await api.loadDemo(); toast(r.loaded.length ? `Cargados ${r.loaded.length} conjuntos de demostración.` : 'Ya estaban cargados.', 'success'); homeView(main); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
        } }, 'Cargar datos de demostración')) : null));
}

function stat(value, label) {
  return h('div', { class: 'hero-stat' }, h('strong', {}, value), h('span', {}, label));
}
