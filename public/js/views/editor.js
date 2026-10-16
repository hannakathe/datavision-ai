// Editor manual: definir columnas, añadir/editar/eliminar filas, pegar datos tabulares y guardar.
import { api } from '../api.js';
import { h, clear, icon, toast, loading, confirmAction } from '../ui.js';
import { invalidate } from '../state.js';
import { EDITOR_MAX_ROWS } from './detail.js';

export function parseTabular(text, hasHeader) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return null;
  const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const cells = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const width = Math.max(...cells.map((r) => r.length));
  const columns = hasHeader ? cells[0].map((c, i) => c || `columna_${i + 1}`) : Array.from({ length: width }, (_, i) => `columna_${i + 1}`);
  while (columns.length < width) columns.push(`columna_${columns.length + 1}`);
  const rows = (hasHeader ? cells.slice(1) : cells).map((r) => columns.map((_, i) => r[i] ?? ''));
  return { columns, rows };
}

export async function editorView(main, params) {
  const editingId = params.id ? Number(params.id) : null;
  const st = { name: '', description: '', columns: ['producto', 'categoria', 'cantidad'], rows: [['', '', ''], ['', '', ''], ['', '', '']] };
  if (editingId) {
    clear(main, loading());
    const meta = await api.dataset(editingId);
    if (meta.rowCount > EDITOR_MAX_ROWS) {
      clear(main, h('div', { class: 'alert alert-error' }, `Este conjunto tiene ${meta.rowCount} filas; el editor manual admite hasta ${EDITOR_MAX_ROWS}. Corrige los datos en el archivo original y vuelve a importarlo.`));
      return;
    }
    const data = await api.rows(editingId);
    Object.assign(st, { name: meta.name, description: meta.description, columns: [...meta.columns], rows: data.rows.map((r) => meta.columns.map((c) => (r[c] === null || r[c] === undefined ? '' : String(r[c])))) });
  }

  const nameI = h('input', { class: 'input', value: st.name, maxlength: 120, id: 'ed-name', placeholder: 'p. ej. Pedidos de la semana', oninput: (e) => { st.name = e.target.value; } });
  const descI = h('input', { class: 'input', value: st.description, maxlength: 500, id: 'ed-desc', placeholder: 'Opcional', oninput: (e) => { st.description = e.target.value; } });
  const grid = h('div', { class: 'table-wrap editor-wrap' });
  const counter = h('span', { class: 'muted small', 'aria-live': 'polite' });
  const paste = h('textarea', { class: 'input mono', rows: 6, placeholder: 'producto\tcantidad\tprecio\nLápiz\t10\t1500', 'aria-label': 'Datos tabulares para pegar' });
  const header = h('input', { type: 'checkbox', checked: true, id: 'ed-header' });

  function renderGrid() {
    const table = h('table', { class: 'table editor' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'rownum' }, '#'),
        st.columns.map((c, ci) => h('th', { scope: 'col' }, h('div', { class: 'col-head' },
          h('input', { class: 'input input-sm head-input', value: c, 'aria-label': `Nombre de la columna ${ci + 1}`, oninput: (e) => { st.columns[ci] = e.target.value; } }),
          h('button', { type: 'button', class: 'btn-icon-sm', title: 'Eliminar columna', 'aria-label': `Eliminar columna ${c || ci + 1}`, onclick: () => removeColumn(ci) }, icon('x'))))),
        h('th', { scope: 'col' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: addColumn }, icon('plus'), 'Columna')))),
      h('tbody', {}, st.rows.map((r, ri) => h('tr', {}, h('td', { class: 'rownum muted' }, ri + 1),
        st.columns.map((_, ci) => h('td', {}, h('input', { class: 'input input-sm cell', value: r[ci] ?? '', 'aria-label': `Fila ${ri + 1}, ${st.columns[ci] || `columna ${ci + 1}`}`, oninput: (e) => { st.rows[ri][ci] = e.target.value; } }))),
        h('td', {}, h('button', { type: 'button', class: 'btn-icon-sm danger', title: 'Eliminar fila', 'aria-label': `Eliminar fila ${ri + 1}`, onclick: () => { st.rows.splice(ri, 1); renderGrid(); } }, icon('trash')))))));
    clear(grid, table);
    counter.textContent = `${st.rows.length} fila(s) · ${st.columns.length} columna(s)`;
  }

  function addColumn() {
    st.columns.push(`columna_${st.columns.length + 1}`);
    st.rows.forEach((r) => r.push(''));
    renderGrid();
  }

  function removeColumn(ci) {
    if (st.columns.length === 1) { toast('Debe quedar al menos una columna.', 'error'); return; }
    st.columns.splice(ci, 1);
    st.rows.forEach((r) => r.splice(ci, 1));
    renderGrid();
  }

  function addRow() {
    if (st.rows.length >= EDITOR_MAX_ROWS) { toast(`Máximo ${EDITOR_MAX_ROWS} filas en el editor.`, 'error'); return; }
    st.rows.push(st.columns.map(() => ''));
    renderGrid();
    grid.querySelector('tbody tr:last-child input')?.focus();
  }

  async function loadPaste() {
    const parsed = parseTabular(paste.value, header.checked);
    if (!parsed) { toast('No hay datos para pegar.', 'error'); return; }
    if (parsed.rows.length > EDITOR_MAX_ROWS) { toast(`Se pegaron ${parsed.rows.length} filas; el máximo es ${EDITOR_MAX_ROWS}. Usa la importación de archivos.`, 'error'); return; }
    const hasData = st.rows.some((r) => r.some((c) => String(c).trim()));
    if (hasData && !(await confirmAction('Reemplazar tabla', 'Los datos pegados reemplazarán la tabla actual del editor. ¿Continuar?', 'Reemplazar'))) return;
    st.columns = parsed.columns;
    st.rows = parsed.rows;
    paste.value = '';
    renderGrid();
    toast(`Se cargaron ${parsed.rows.length} fila(s) y ${parsed.columns.length} columna(s).`, 'success');
  }

  function validate() {
    const errors = [];
    if (!st.name.trim()) errors.push('Escribe un nombre para el conjunto.');
    const names = st.columns.map((c) => c.trim());
    if (names.some((c) => !c)) errors.push('Todas las columnas deben tener nombre.');
    const lower = names.map((c) => c.toLowerCase());
    if (new Set(lower).size !== lower.length) errors.push('Hay nombres de columna repetidos.');
    if (!st.rows.some((r) => r.some((c) => String(c).trim()))) errors.push('Agrega al menos una fila con datos.');
    return errors;
  }

  async function save(e) {
    const errors = validate();
    if (errors.length) { toast(errors.join(' '), 'error'); return; }
    e.target.disabled = true;
    const body = { name: st.name, description: st.description, columns: st.columns.map((c) => c.trim()), rows: st.rows.filter((r) => r.some((c) => String(c).trim())) };
    try {
      const d = editingId ? await api.replaceRows(editingId, body) : await api.createDataset(body);
      invalidate(d.id);
      toast(`«${d.name}» guardado con ${d.rowCount} fila(s).`, 'success');
      location.hash = `#/conjunto/${d.id}`;
    } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
  }

  clear(main,
    h('section', { class: 'card' },
      h('div', { class: 'form-grid' },
        h('label', { class: 'field', for: 'ed-name' }, h('span', {}, 'Nombre del conjunto *'), nameI),
        h('label', { class: 'field', for: 'ed-desc' }, h('span', {}, 'Descripción'), descI)),
      h('p', { class: 'muted small' }, 'Escribe los encabezados y los valores. Los tipos (número, fecha, booleano, categoría) se detectan al guardar. Fechas recomendadas: AAAA-MM-DD.'),
      grid,
      h('div', { class: 'form-actions spread' }, counter,
        h('div', {},
          h('button', { type: 'button', class: 'btn btn-ghost', onclick: addRow }, icon('plus'), 'Añadir fila'), ' ',
          h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, icon('save'), editingId ? 'Guardar cambios' : 'Guardar conjunto')))),
    h('details', { class: 'card paste' },
      h('summary', {}, 'Pegar datos desde Excel, Google Sheets o texto'),
      h('p', { class: 'muted small' }, 'Copia un rango de celdas y pégalo aquí. Se aceptan tabulaciones, punto y coma o comas como separador.'),
      paste,
      h('label', { class: 'check', for: 'ed-header' }, header, h('span', {}, 'La primera fila contiene los encabezados')),
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: loadPaste }, 'Cargar datos pegados'))));
  renderGrid();
}
