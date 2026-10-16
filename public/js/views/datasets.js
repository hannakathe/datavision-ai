import { api } from '../api.js';
import { h, clear, icon, toast, confirmAction, badge, loading, emptyState, dialog } from '../ui.js';
import { invalidate } from '../state.js';
import { STATUS_LABELS } from '../core/quality.js';
import { fmtNumber, fmtDateTime } from '../core/format.js';

export const statusKind = (s) => ({ valido: 'ok', con_advertencias: 'warn', con_errores: 'err' }[s] || 'neutral');

export const SOURCE_LABELS = { csv: 'CSV', json: 'JSON', xlsx: 'Excel', sqlite: 'SQLite', manual: 'Manual', limpieza: 'Limpieza' };

export async function renameDataset(d) {
  const name = h('input', { class: 'input', value: d.name, maxlength: 120, required: true });
  const desc = h('textarea', { class: 'input', rows: 3, maxlength: 500 }, d.description || '');
  setTimeout(() => name.focus(), 30);
  const res = await dialog({ title: 'Renombrar conjunto de datos', body: h('div', { class: 'form-grid one' }, h('label', { class: 'field' }, h('span', {}, 'Nombre'), name), h('label', { class: 'field' }, h('span', {}, 'Descripción (opcional)'), desc)), actions: [{ label: 'Guardar', value: 'ok', primary: true }] });
  if (res !== 'ok') return false;
  try {
    await api.updateDataset(d.id, { name: name.value, description: desc.value });
    invalidate(d.id);
    toast('Conjunto actualizado.', 'success');
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

export async function deleteDataset(d) {
  if (!(await confirmAction('Eliminar conjunto de datos', `¿Eliminar «${d.name}» con sus ${fmtNumber(d.rowCount)} filas y sus configuraciones de dashboard? Esta acción no se puede deshacer.`))) return false;
  try {
    await api.deleteDataset(d.id);
    invalidate(d.id);
    toast('Conjunto eliminado.', 'success');
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

export async function datasetsView(main) {
  clear(main, loading());
  const list = await api.datasets();
  if (!list.length) {
    clear(main, emptyState('No hay conjuntos de datos', 'Importa un archivo, usa el editor manual, la consola o carga los datos de demostración desde el inicio.',
      h('a', { class: 'btn btn-primary', href: '#/importar' }, 'Importar datos'), h('a', { class: 'btn btn-ghost', href: '#/editor' }, 'Editor manual')));
    return;
  }
  const rows = list.map((d) => h('tr', {},
    h('td', {}, h('a', { href: `#/conjunto/${d.id}`, class: 'strong-link' }, d.name), d.isDemo ? [' ', badge('Demo ficticia', 'warn')] : null,
      d.description ? h('div', { class: 'muted small clamp' }, d.description) : null),
    h('td', {}, SOURCE_LABELS[d.sourceType] || d.sourceType, h('div', { class: 'muted small' }, d.sourceDetail)),
    h('td', { class: 'num' }, fmtNumber(d.rowCount)),
    h('td', { class: 'num' }, fmtNumber(d.columnCount)),
    h('td', {}, badge(STATUS_LABELS[d.status], statusKind(d.status))),
    h('td', { class: 'small' }, fmtDateTime(d.createdAt)),
    h('td', { class: 'actions' },
      h('a', { class: 'btn btn-primary btn-sm', href: `#/dashboard/${d.id}` }, icon('chart'), 'Dashboard'),
      h('a', { class: 'btn-icon-sm', href: `#/conjunto/${d.id}`, title: 'Detalle y validación', 'aria-label': `Detalle de ${d.name}` }, icon('eye')),
      h('button', { type: 'button', class: 'btn-icon-sm', title: 'Renombrar', 'aria-label': `Renombrar ${d.name}`, onclick: async () => { if (await renameDataset(d)) datasetsView(main); } }, icon('edit')),
      h('button', { type: 'button', class: 'btn-icon-sm danger', title: 'Eliminar', 'aria-label': `Eliminar ${d.name}`, onclick: async () => { if (await deleteDataset(d)) datasetsView(main); } }, icon('trash')))));
  clear(main,
    h('div', { class: 'page-actions' }, h('p', { class: 'muted' }, `${list.length} conjunto(s) almacenados localmente en SQLite.`),
      h('div', {}, h('a', { class: 'btn btn-primary', href: '#/importar' }, icon('upload'), 'Importar'), ' ', h('a', { class: 'btn btn-ghost', href: '#/editor' }, icon('plus'), 'Nuevo manual'))),
    h('section', { class: 'card' }, h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Conjuntos de datos' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {}, ['Nombre', 'Origen', 'Filas', 'Columnas', 'Validación', 'Creado', 'Acciones'].map((t) => h('th', { scope: 'col', class: ['Filas', 'Columnas'].includes(t) ? 'num' : null }, t)))),
        h('tbody', {}, rows)))));
}
