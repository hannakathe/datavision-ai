import { api } from '../api.js';
import { h, clear, icon, toast, loading, confirmAction, badge } from '../ui.js';
import { loadDataset, invalidate, setLastDataset } from '../state.js';
import { fmtNumber, fmtDateTime } from '../core/format.js';
import { schemaTable, issuesList } from './validation.js';
import { recordsView } from './records.js';
import { renameDataset, deleteDataset, SOURCE_LABELS } from './datasets.js';

const STRATEGIES = {
  '': 'No cambiar',
  drop: 'Eliminar filas con vacío',
  fill_value: 'Reemplazar por un valor…',
  fill_mean: 'Reemplazar por el promedio',
  fill_median: 'Reemplazar por la mediana',
  fill_mode: 'Reemplazar por el valor más frecuente',
};

export const EDITOR_MAX_ROWS = 2000;

export async function detailView(main, params) {
  clear(main, loading());
  const id = Number(params.id);
  const { meta, prep } = await loadDataset(id);
  setLastDataset(id);
  const v = meta.validation;

  const onTypeChange = async (column, type) => {
    try {
      await api.updateDataset(id, { columnTypes: { [column]: type } });
      invalidate(id);
      toast(`Tipo de «${column}» cambiado. Validación recalculada.`, 'success');
      detailView(main, params);
    } catch (e) { toast(e.message, 'error'); }
  };

  clear(main,
    h('section', { class: 'card detail-head' },
      h('div', {},
        h('p', { class: 'eyebrow' }, `Conjunto #${meta.id}`, meta.isDemo ? [' · ', badge('Datos ficticios de demostración', 'warn')] : null),
        h('h2', {}, meta.name),
        meta.description ? h('p', { class: 'muted' }, meta.description) : null,
        h('dl', { class: 'meta-grid' },
          ...[['Origen', `${SOURCE_LABELS[meta.sourceType] || meta.sourceType}${meta.sourceDetail ? ` · ${meta.sourceDetail}` : ''}`], ['Creado', fmtDateTime(meta.createdAt)], ['Actualizado', fmtDateTime(meta.updatedAt)], ['Filas', fmtNumber(meta.rowCount)], ['Columnas', fmtNumber(meta.columnCount)]]
            .map(([k, val]) => h('div', {}, h('dt', {}, k), h('dd', {}, val))))),
      h('div', { class: 'detail-actions' },
        h('a', { class: 'btn btn-primary', href: `#/dashboard/${id}` }, icon('chart'), 'Abrir dashboard'),
        meta.rowCount <= EDITOR_MAX_ROWS ? h('a', { class: 'btn btn-ghost', href: `#/editor/${id}` }, icon('table'), 'Editar datos') : null,
        h('button', { type: 'button', class: 'btn btn-ghost', onclick: async () => { if (await renameDataset(meta)) detailView(main, params); } }, icon('edit'), 'Renombrar'),
        h('a', { class: 'btn btn-ghost', href: `/api/datasets/${id}/export.csv`, download: '' }, icon('download'), 'Exportar CSV'),
        h('button', { type: 'button', class: 'btn btn-danger-ghost', onclick: async () => { if (await deleteDataset(meta)) location.hash = '#/conjuntos'; } }, icon('trash'), 'Eliminar'))),
    h('section', { class: 'card' }, h('h3', {}, 'Validación y calidad'), issuesList(v)),
    h('section', { class: 'card' }, h('h3', {}, 'Esquema detectado'), h('p', { class: 'muted small' }, 'Si un tipo no es correcto (p. ej., un código numérico que debería ser categoría), cámbialo aquí; los cálculos y el dashboard se adaptan.'),
      schemaTable(meta.schema, v, { onTypeChange })),
    cleaningCard(meta, v, main, params),
    h('section', { class: 'card' }, h('h3', {}, 'Explorar registros'), h('p', { class: 'muted small' }, 'Busca y ordena (clic en el encabezado). Los filtros avanzados están en el dashboard.'), recordsView(prep, prep.allIdx)));
}

function cleaningCard(meta, v, main, params) {
  const withMissing = meta.schema.columns.filter((c) => (v.byColumn?.[c.name]?.missing || 0) > 0);
  if (!v.duplicateCount && !withMissing.length) {
    return h('section', { class: 'card' }, h('h3', {}, 'Correcciones'), h('p', { class: 'ok-text' }, 'No hay duplicados ni valores vacíos que tratar.'));
  }
  const dup = h('input', { type: 'checkbox', id: 'cl-dup' });
  const rules = withMissing.map((c) => {
    const value = h('input', { class: 'input input-sm', placeholder: 'Valor de reemplazo', hidden: true, 'aria-label': `Valor de reemplazo para ${c.name}` });
    const sel = h('select', { class: 'input input-sm', 'aria-label': `Tratamiento de vacíos en ${c.name}`, onchange: () => { value.hidden = sel.value !== 'fill_value'; } },
      Object.entries(STRATEGIES).filter(([k]) => c.type === 'numerico' || !['fill_mean', 'fill_median'].includes(k)).map(([k, l]) => h('option', { value: k }, l)));
    return { c, sel, value };
  });
  const modeCopy = h('input', { type: 'radio', name: 'cl-mode', value: 'copy', checked: true, id: 'cl-copy' });
  const modeReplace = h('input', { type: 'radio', name: 'cl-mode', value: 'replace', id: 'cl-replace' });
  const result = h('div', { 'aria-live': 'polite' });

  const apply = async (e) => {
    const body = {
      removeDuplicates: dup.checked,
      missing: rules.filter((r) => r.sel.value).map((r) => ({ column: r.c.name, strategy: r.sel.value, value: r.value.value })),
      mode: modeReplace.checked ? 'replace' : 'copy',
    };
    if (!body.removeDuplicates && !body.missing.length) { toast('Selecciona al menos una corrección.', 'error'); return; }
    if (body.mode === 'replace' && !(await confirmAction('Reemplazar datos', 'Las correcciones modificarán este conjunto de forma permanente. ¿Continuar?', 'Reemplazar'))) return;
    e.target.disabled = true;
    try {
      const r = await api.cleanDataset(meta.id, body);
      invalidate(meta.id);
      toast(r.report.join(' '), 'success');
      location.hash = `#/conjunto/${r.dataset.id}`;
      if (r.dataset.id === meta.id) detailView(main, params);
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  };

  return h('section', { class: 'card' },
    h('h3', {}, 'Correcciones opcionales'),
    h('p', { class: 'muted small' }, 'Elige qué tratar. Por defecto se crea una copia «(limpio)» y el original queda intacto.'),
    v.duplicateCount ? h('label', { class: 'check', for: 'cl-dup' }, dup, h('span', {}, `Eliminar ${v.duplicateCount} fila(s) duplicada(s) exacta(s)`)) : null,
    rules.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Columna con vacíos'), h('th', { scope: 'col' }, 'Vacíos'), h('th', { scope: 'col' }, 'Tratamiento'))),
      h('tbody', {}, rules.map((r) => h('tr', {}, h('th', { scope: 'row' }, r.c.name), h('td', {}, fmtNumber(v.byColumn[r.c.name].missing)), h('td', { class: 'rule-cell' }, r.sel, r.value)))))) : null,
    h('fieldset', { class: 'radio-row' }, h('legend', {}, 'Resultado'),
      h('label', { for: 'cl-copy', class: 'check' }, modeCopy, h('span', {}, 'Crear un conjunto nuevo (recomendado)')),
      h('label', { for: 'cl-replace', class: 'check' }, modeReplace, h('span', {}, 'Reemplazar este conjunto'))),
    h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: apply }, 'Aplicar correcciones')),
    result);
}
