// Tabla de registros con búsqueda local, ordenamiento por columna y paginación.
import { h, clear, dataTable } from '../ui.js';
import { applyFilters } from '../core/data.js';
import { fmtNumber } from '../core/format.js';

export function recordsView(prep, baseIdx, { pageSize = 25, searchable = true, caption = 'Registros' } = {}) {
  const st = { search: '', sort: null, page: 0 };
  const root = h('div', { class: 'records' });
  const types = Object.fromEntries(prep.schema.columns.map((c) => [c.name, c.type]));
  const columns = prep.schema.columns.map((c) => c.name);
  let searchSet = null;

  const searchInput = searchable ? h('input', {
    type: 'search', class: 'input input-sm', placeholder: 'Buscar en los registros…', 'aria-label': 'Buscar en los registros',
    oninput: (e) => { st.search = e.target.value; st.page = 0; searchSet = st.search.trim() ? new Set(applyFilters(prep, [], st.search)) : null; render(); },
  }) : null;
  const info = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const body = h('div');
  const pager = h('div', { class: 'pager' });
  root.append(h('div', { class: 'records-bar' }, searchInput, info), body, pager);

  function onSort(col) {
    st.sort = st.sort?.column === col ? (st.sort.dir === 'asc' ? { column: col, dir: 'desc' } : null) : { column: col, dir: 'asc' };
    st.page = 0;
    render();
  }

  function render() {
    let idx = searchSet ? baseIdx.filter((i) => searchSet.has(i)) : [...baseIdx];
    if (st.sort) {
      const col = prep.cols[st.sort.column];
      const dir = st.sort.dir === 'asc' ? 1 : -1;
      idx.sort((a, b) => (col[a] === null) - (col[b] === null) || (col[a] < col[b] ? -dir : col[a] > col[b] ? dir : 0));
    }
    const pages = Math.max(1, Math.ceil(idx.length / pageSize));
    st.page = Math.min(st.page, pages - 1);
    const slice = idx.slice(st.page * pageSize, (st.page + 1) * pageSize).map((i) => prep.rows[i]);
    info.textContent = `${fmtNumber(idx.length)} registro(s)`;
    clear(body, idx.length ? dataTable(columns, slice, { sort: st.sort, onSort, caption, types }) : h('p', { class: 'empty-inline' }, 'No hay registros que coincidan.'));
    clear(pager,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: st.page === 0, onclick: () => { st.page--; render(); } }, '← Anterior'),
      h('span', { class: 'small muted' }, `Página ${st.page + 1} de ${pages}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: st.page >= pages - 1, onclick: () => { st.page++; render(); } }, 'Siguiente →'));
  }
  render();
  return root;
}
