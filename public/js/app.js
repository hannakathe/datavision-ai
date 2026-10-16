// Enrutador por hash y estructura general de la aplicación.
import { h, clear, icon } from './ui.js';
import { homeView } from './views/home.js';
import { importView } from './views/import.js';
import { editorView } from './views/editor.js';
import { datasetsView } from './views/datasets.js';
import { detailView } from './views/detail.js';
import { dashboardView, destroyCharts } from './views/dashboard.js';
import { lastDatasetId } from './state.js';

const ROUTES = [
  { path: '', title: 'Inicio', nav: 'Inicio', icon: 'home', view: homeView },
  { path: 'importar', title: 'Importar datos', nav: 'Importar datos', icon: 'upload', view: importView },
  { path: 'editor', title: 'Editor manual', nav: 'Editor manual', icon: 'table', view: editorView },
  { path: 'conjuntos', title: 'Conjuntos de datos', nav: 'Conjuntos de datos', icon: 'db', view: datasetsView },
  { path: 'conjunto', title: 'Detalle y validación', view: detailView, parent: 'conjuntos' },
  { path: 'dashboard', title: 'Dashboard', nav: 'Dashboard', icon: 'chart', view: (m, p) => dashboardView(m, p) },
  { path: 'analisis', title: 'Análisis inteligente', nav: 'Análisis inteligente', icon: 'spark', view: (m, p) => dashboardView(m, p, { tab: 'analisis' }) },
];

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const pageTitle = document.getElementById('page-title');
const sidebar = document.querySelector('.sidebar');

function renderNav(active) {
  clear(nav, ROUTES.filter((r) => r.nav).map((r) => {
    const isActive = r.path === active.path || r.path === active.parent;
    const href = (r.path === 'dashboard' || r.path === 'analisis') && lastDatasetId() ? `#/${r.path}/${lastDatasetId()}` : `#/${r.path}`;
    return h('a', { href, class: `nav-link${isActive ? ' active' : ''}`, 'aria-current': isActive ? 'page' : null }, icon(r.icon), h('span', {}, r.nav));
  }));
}

async function route() {
  const [, path = '', id] = location.hash.replace(/^#/, '').split('/');
  const r = ROUTES.find((x) => x.path === path) || ROUTES[0];
  document.title = `${r.title} · DataVision AI`;
  pageTitle.textContent = r.title;
  renderNav(r);
  sidebar.classList.remove('open');
  destroyCharts(); // evita gráficas huérfanas al cambiar de vista
  try {
    await r.view(main, { id });
  } catch (e) {
    console.error(e);
    clear(main, h('div', { class: 'alert alert-error', role: 'alert' }, h('strong', {}, 'No se pudo cargar esta vista. '), e.message || 'Error inesperado.', ' ', h('a', { href: '#/' }, 'Volver al inicio')));
  }
  main.focus({ preventScroll: true });
}

document.getElementById('menu-btn').addEventListener('click', () => {
  const open = sidebar.classList.toggle('open');
  document.getElementById('menu-btn').setAttribute('aria-expanded', String(open));
});
document.getElementById('menu-btn').append(icon('menu'));
window.addEventListener('hashchange', route);
route();
