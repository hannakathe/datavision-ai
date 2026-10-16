import { api } from '../api.js';
import { h, clear, icon, toast, loading, dataTable } from '../ui.js';
import { fmtNumber } from '../core/format.js';
import { schemaTable, issuesList } from './validation.js';

const FORMAT_LABELS = { csv: 'CSV', json: 'JSON', xlsx: 'Excel XLSX', sqlite: 'SQLite' };

export async function importView(main) {
  const info = await api.importers().catch(() => null);
  const accept = info ? info.importers.flatMap((i) => i.extensions).join(',') : '.csv,.json,.xlsx';
  const limits = info?.limits;
  let file = null;

  const input = h('input', { type: 'file', id: 'file-input', class: 'sr-only', accept, onchange: (e) => { if (e.target.files[0]) select(e.target.files[0]); } });
  const drop = h('label', { class: 'dropzone', for: 'file-input', tabindex: '0',
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); drop.classList.add('over'); },
    ondragleave: () => drop.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) select(e.dataTransfer.files[0]); } },
  h('span', { class: 'drop-icon' }, icon('upload')),
  h('strong', {}, 'Arrastra un archivo aquí o haz clic para seleccionarlo'),
  h('span', { class: 'muted small' }, `Formatos: ${accept.replaceAll(',', ' ')}${limits ? ` · máx. ${limits.maxUploadMb} MB, ${fmtNumber(limits.maxRows)} filas y ${limits.maxColumns} columnas` : ''}`));
  const previewEl = h('div', { class: 'preview', 'aria-live': 'polite' });

  const methods = (info?.importers || []).map((i) => h('li', { class: `method ${i.status}` },
    h('span', {}, i.label), h('span', { class: `badge ${i.status === 'disponible' ? 'badge-ok' : 'badge-neutral'}` }, i.status === 'disponible' ? 'Disponible' : 'Ampliación futura (no implementado)')));

  clear(main,
    h('div', { class: 'grid-import' },
      h('section', { class: 'card' }, h('h3', {}, 'Importar un archivo'), input, drop, previewEl),
      h('aside', { class: 'card side' },
        h('h3', {}, 'Métodos de entrada'), h('ul', { class: 'methods' }, methods),
        h('h4', {}, 'Desde la consola de Node.js'),
        h('pre', { class: 'code' }, 'npm run import -- ruta/archivo.csv --name "Mis ventas"'),
        h('p', { class: 'muted small' }, 'También admite --sheet (Excel), --table (SQLite) y --description. Recarga la lista de conjuntos para ver el resultado.'),
        h('h4', {}, 'Base de datos SQLite'),
        h('p', { class: 'muted small' }, 'Sube un archivo .db/.sqlite: se abre en modo solo lectura, eliges una tabla de la lista y se importa. No se permite SQL libre.'),
        h('a', { class: 'btn btn-ghost btn-sm', href: '#/editor' }, icon('edit'), 'Abrir editor manual'))));

  async function select(f, opts = {}) {
    file = f;
    clear(previewEl, loading(`Analizando «${f.name}»…`));
    const form = new FormData();
    form.append('archivo', f);
    if (opts.sheet) form.append('sheet', opts.sheet);
    if (opts.table) form.append('table', opts.table);
    try {
      renderPreview(await api.preview(form));
    } catch (e) {
      clear(previewEl, h('div', { class: 'alert alert-error', role: 'alert' }, h('strong', {}, 'No se pudo importar el archivo. '), e.message));
    } finally {
      input.value = '';
    }
  }

  function renderPreview(p) {
    const base = p.fileName.replace(/\.[^.]+$/, '');
    const name = h('input', { class: 'input', value: base.slice(0, 120), maxlength: 120, required: true, id: 'imp-name' });
    const desc = h('textarea', { class: 'input', rows: 2, maxlength: 500, id: 'imp-desc', placeholder: 'Opcional' });
    const picker = [];
    if (p.meta.sheets?.length > 1) {
      picker.push(h('label', { class: 'field' }, h('span', {}, 'Hoja de Excel'), h('select', { class: 'input', onchange: (e) => select(file, { sheet: e.target.value }) }, p.meta.sheets.map((s) => h('option', { value: s, selected: s === p.meta.sheet }, s)))));
    }
    if (p.meta.tables?.length > 1) {
      picker.push(h('label', { class: 'field' }, h('span', {}, 'Tabla de la base de datos'), h('select', { class: 'input', onchange: (e) => select(file, { table: e.target.value }) }, p.meta.tables.map((s) => h('option', { value: s, selected: s === p.meta.table }, s)))));
    }
    const canSave = p.rowCount > 0;
    const saveBtn = (goDash) => h('button', { type: 'button', class: `btn ${goDash ? 'btn-primary' : 'btn-ghost'}`, disabled: !canSave, onclick: async (e) => {
      if (!name.value.trim()) { toast('Escribe un nombre para el conjunto.', 'error'); name.focus(); return; }
      e.target.disabled = true;
      try {
        const d = await api.commit({ uploadId: p.uploadId, name: name.value, description: desc.value });
        toast(`«${d.name}» guardado (${fmtNumber(d.rowCount)} filas).`, 'success');
        location.hash = goDash ? `#/dashboard/${d.id}` : `#/conjunto/${d.id}`;
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    } }, goDash ? 'Guardar y generar dashboard' : 'Guardar y revisar');

    clear(previewEl,
      h('div', { class: 'preview-head' }, h('h3', {}, 'Vista previa'), h('span', { class: 'muted' }, `${p.fileName} · ${FORMAT_LABELS[p.format]} · ${fmtNumber(p.rowCount)} filas · ${p.columns.length} columnas`)),
      picker.length ? h('div', { class: 'form-grid' }, picker) : null,
      issuesList(p.validation),
      h('h4', {}, 'Esquema detectado'),
      schemaTable(p.schema, p.validation),
      h('h4', {}, `Primeras ${Math.min(20, p.rowCount)} filas`),
      p.rowCount ? dataTable(p.columns, p.previewRows, { caption: 'Vista previa de filas', types: Object.fromEntries(p.schema.columns.map((c) => [c.name, c.type])) }) : h('p', { class: 'alert alert-error' }, 'El archivo no contiene filas con datos; no se puede guardar.'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field', for: 'imp-name' }, h('span', {}, 'Nombre del conjunto *'), name), h('label', { class: 'field', for: 'imp-desc' }, h('span', {}, 'Descripción'), desc)),
      h('div', { class: 'form-actions' }, h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => clear(previewEl) }, 'Cancelar'), saveBtn(false), saveBtn(true)));
  }
}
