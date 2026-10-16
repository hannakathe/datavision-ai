// Componentes de esquema y validación compartidos por la vista previa de importación y el detalle del conjunto.
import { h, badge } from '../ui.js';
import { TYPE_LABELS, TYPES } from '../core/types.js';
import { STATUS_LABELS } from '../core/quality.js';
import { fmtNumber, fmtPct } from '../core/format.js';
import { statusKind } from './datasets.js';

const ROLE_LABELS = { medida: 'Medida', dimension: 'Dimensión', tiempo: 'Tiempo', identificador: 'Identificador', atributo: 'Atributo' };

export function schemaTable(schema, validation, { onTypeChange } = {}) {
  const n = validation.rowCount || 0;
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': 'Esquema detectado' }, h('table', { class: 'table' },
    h('thead', {}, h('tr', {}, ['Columna', 'Tipo', 'Rol', 'Vacíos', 'Inválidos', 'Únicos', 'Ejemplos'].map((t) => h('th', { scope: 'col' }, t)))),
    h('tbody', {}, schema.columns.map((c) => {
      const q = validation.byColumn?.[c.name] || {};
      const typeCell = onTypeChange
        ? h('select', { class: 'input input-sm', 'aria-label': `Tipo de ${c.name}`, onchange: (e) => onTypeChange(c.name, e.target.value) },
          TYPES.map((t) => h('option', { value: t, selected: t === c.type }, `${TYPE_LABELS[t]}${t === c.detectedType ? ' (detectado)' : ''}`)))
        : badge(TYPE_LABELS[c.type], 'type');
      return h('tr', {},
        h('th', { scope: 'row' }, c.name),
        h('td', {}, typeCell),
        h('td', { class: 'small' }, ROLE_LABELS[c.role] || c.role),
        h('td', { class: (q.missing ?? c.missing) ? 'warn-text' : 'muted' }, `${fmtNumber(q.missing ?? c.missing)}${n ? ` (${fmtPct((q.missing ?? c.missing) / n, 0)})` : ''}`),
        h('td', { class: q.invalid ? 'warn-text' : 'muted' }, fmtNumber(q.invalid ?? 0)),
        h('td', {}, fmtNumber(c.unique)),
        h('td', { class: 'small muted clamp' }, c.sample.join(' · ')));
    }))));
}

export function issuesList(validation) {
  const all = [...(validation.importWarnings || []).map((m) => ({ level: 'info', message: m, source: 'Importación' })), ...validation.issues];
  return h('div', { class: 'issues' },
    h('p', {}, 'Estado de validación: ', badge(STATUS_LABELS[validation.status], statusKind(validation.status)),
      ` · ${fmtNumber(validation.rowCount)} filas · ${validation.columnCount} columnas · ${fmtNumber(validation.duplicateCount)} duplicadas`),
    all.length
      ? h('ul', { class: 'issue-list' }, all.map((i) => h('li', { class: `issue ${i.level}` }, h('span', { class: 'issue-level' }, { error: 'Error', warning: 'Advertencia', info: 'Aviso' }[i.level]), i.message)))
      : h('p', { class: 'ok-text' }, 'No se encontraron problemas de calidad.'),
    h('p', { class: 'muted small' }, 'Ningún dato se modifica automáticamente: las correcciones se aplican solo si las eliges en la vista del conjunto.'));
}
