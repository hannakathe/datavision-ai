// Consola de datos: ingreso de datos mediante comandos de texto. Funciona igual con el servidor local y en el modo navegador.
// Los comandos son un pequeño lenguaje propio interpretado aquí; nunca se ejecuta el texto como código.
import { api } from '../api.js';
import { h, clear, icon } from '../ui.js';
import { invalidate } from '../state.js';
import { STATUS_LABELS } from '../core/quality.js';
import { TYPE_LABELS } from '../core/types.js';
import { fmtNumber } from '../core/format.js';
import { EDITOR_MAX_ROWS } from './detail.js';
import { splitValues } from '../core/manage.js';

const HELP = [
  ['ayuda', 'Muestra esta lista de comandos.'],
  ['nuevo <nombre> | col1, col2, …', 'Empieza un conjunto nuevo con esas columnas.'],
  ['fila v1, v2, …', 'Añade una fila al conjunto en preparación (Mayús+Enter para varias filas a la vez).'],
  ['csv <nombre>  (y en las líneas siguientes los datos)', 'Crea el conjunto en preparación a partir de texto CSV: la primera línea son los encabezados.'],
  ['ver', 'Muestra el conjunto en preparación.'],
  ['deshacer', 'Quita la última fila añadida.'],
  ['guardar [descripción]', 'Valida y guarda el conjunto en preparación.'],
  ['cancelar', 'Descarta el conjunto en preparación.'],
  ['listar', 'Lista los conjuntos guardados con su id.'],
  ['info <id>', 'Muestra columnas, tipos y validación de un conjunto.'],
  ['agregar <id> | v1, v2, …', `Añade filas a un conjunto existente (hasta ${EDITOR_MAX_ROWS} filas).`],
  ['abrir <id>', 'Abre el dashboard del conjunto.'],
  ['eliminar <id> confirmar', 'Elimina un conjunto (exige la palabra «confirmar»).'],
  ['demo', 'Carga los datos ficticios de demostración que falten.'],
  ['limpiar', 'Limpia la pantalla.'],
];

const session = { draft: null, history: [], lines: [] };

function splitPipe(rest) {
  const i = rest.indexOf('|');
  return i < 0 ? [rest.trim(), ''] : [rest.slice(0, i).trim(), rest.slice(i + 1).trim()];
}

export async function runCommand(input, print) {
  const [first, ...more] = input.replace(/\r/g, '').split('\n');
  const trimmed = first.trim();
  const cmd = trimmed.split(/\s+/)[0].toLowerCase();
  const rest = trimmed.slice(cmd.length).trim();
  const extraLines = more.filter((l) => l.trim());
  const d = session.draft;

  switch (cmd) {
    case '':
      return;
    case 'ayuda':
    case 'help':
      print('info', 'Comandos disponibles:');
      for (const [c, t] of HELP) print('help', c, t);
      return;
    case 'limpiar':
    case 'clear':
      session.lines = [];
      return 'clear';
    case 'nuevo': {
      const [name, cols] = splitPipe(rest);
      if (!name || !cols) throw new Error('Uso: nuevo <nombre> | col1, col2, …   p. ej.: nuevo Ventas | producto, cantidad, precio');
      const columns = splitValues(cols).filter(Boolean);
      if (!columns.length) throw new Error('Indica al menos una columna.');
      if (new Set(columns.map((c) => c.toLowerCase())).size !== columns.length) throw new Error('Hay nombres de columna repetidos.');
      session.draft = { name, columns, rows: [] };
      print('ok', `Conjunto «${name}» en preparación con ${columns.length} columna(s): ${columns.map((c) => `«${c}»`).join(', ')}. Añade filas con «fila …».`);
      return;
    }
    case 'csv': {
      if (!rest) throw new Error('Uso: csv <nombre>, y en las líneas siguientes (Mayús+Enter) el encabezado y las filas.');
      if (extraLines.length < 2) throw new Error('Escribe al menos la línea de encabezados y una fila debajo del comando (usa Mayús+Enter para saltar de línea).');
      const [header, ...rows] = extraLines.map(splitValues);
      session.draft = { name: rest, columns: header, rows: rows.map((r) => header.map((_, i) => r[i] ?? '')) };
      print('ok', `Conjunto «${rest}» en preparación: ${header.length} columna(s), ${rows.length} fila(s). Escribe «ver» para revisarlo o «guardar».`);
      return;
    }
    case 'fila':
    case 'filas': {
      if (!d) throw new Error('Primero crea un conjunto con «nuevo <nombre> | columnas».');
      const lines = [rest, ...extraLines].filter((l) => l.trim());
      if (!lines.length) throw new Error('Uso: fila v1, v2, …');
      for (const l of lines) {
        const vals = splitValues(l);
        if (vals.length > d.columns.length) throw new Error(`La fila «${l}» tiene ${vals.length} valores y el conjunto ${d.columns.length} columnas.`);
        d.rows.push(d.columns.map((_, i) => vals[i] ?? ''));
      }
      if (d.rows.length > EDITOR_MAX_ROWS) { d.rows.length = EDITOR_MAX_ROWS; throw new Error(`Máximo ${EDITOR_MAX_ROWS} filas por consola; usa la importación de archivos para más.`); }
      print('ok', `${lines.length} fila(s) añadida(s). Total: ${d.rows.length}.`);
      return;
    }
    case 'ver':
      if (!d) throw new Error('No hay un conjunto en preparación.');
      print('info', `«${d.name}» · ${d.rows.length} fila(s)`);
      print('table', d.columns, d.rows.slice(-15));
      if (d.rows.length > 15) print('info', `(se muestran las últimas 15 de ${d.rows.length})`);
      return;
    case 'deshacer':
      if (!d || !d.rows.length) throw new Error('No hay filas que quitar.');
      d.rows.pop();
      print('ok', `Última fila quitada. Quedan ${d.rows.length}.`);
      return;
    case 'cancelar':
      if (!d) throw new Error('No hay un conjunto en preparación.');
      session.draft = null;
      print('ok', 'Conjunto en preparación descartado.');
      return;
    case 'guardar': {
      if (!d) throw new Error('No hay un conjunto en preparación.');
      const ds = await api.createDataset({ name: d.name, description: rest, columns: d.columns, rows: d.rows, source: 'consola' });
      session.draft = null;
      print('ok', `✔ Guardado #${ds.id} «${ds.name}»: ${fmtNumber(ds.rowCount)} filas · ${ds.columnCount} columnas · ${STATUS_LABELS[ds.status]}.`);
      print('info', `Tipos detectados: ${ds.schema.columns.map((c) => `${c.name} (${TYPE_LABELS[c.type]})`).join(', ')}`);
      for (const i of ds.validation.issues.filter((x) => x.level !== 'info').slice(0, 5)) print('warn', i.message);
      print('link', `Abrir dashboard de «${ds.name}»`, `#/dashboard/${ds.id}`);
      return;
    }
    case 'listar': {
      const list = await api.datasets();
      if (!list.length) { print('info', 'No hay conjuntos guardados. Escribe «demo» o crea uno con «nuevo».'); return; }
      print('table', ['id', 'nombre', 'filas', 'columnas', 'estado'], list.map((x) => [x.id, x.name, x.rowCount, x.columnCount, STATUS_LABELS[x.status]]));
      return;
    }
    case 'info': {
      const ds = await api.dataset(Number(rest));
      print('info', `#${ds.id} «${ds.name}» · ${fmtNumber(ds.rowCount)} filas · origen ${ds.sourceType} · ${STATUS_LABELS[ds.status]}`);
      print('table', ['columna', 'tipo', 'vacíos', 'únicos'], ds.schema.columns.map((c) => [c.name, TYPE_LABELS[c.type], ds.validation.byColumn?.[c.name]?.missing ?? c.missing, c.unique]));
      return;
    }
    case 'agregar': {
      const [idText, values] = splitPipe(rest);
      const id = Number(idText);
      const lines = [values, ...extraLines].filter((l) => l.trim());
      if (!Number.isInteger(id) || !lines.length) throw new Error('Uso: agregar <id> | v1, v2, …');
      const ds = await api.dataset(id);
      if (ds.rowCount + lines.length > EDITOR_MAX_ROWS) throw new Error(`El conjunto quedaría con más de ${EDITOR_MAX_ROWS} filas; vuelve a importarlo desde un archivo.`);
      const { rows } = await api.rows(id);
      const newRows = lines.map((l) => {
        const vals = splitValues(l);
        if (vals.length > ds.columns.length) throw new Error(`La fila «${l}» tiene ${vals.length} valores y el conjunto ${ds.columns.length} columnas (${ds.columns.join(', ')}).`);
        return ds.columns.map((_, i) => vals[i] ?? '');
      });
      const all = [...rows.map((r) => ds.columns.map((c) => (r[c] === null || r[c] === undefined ? '' : r[c]))), ...newRows];
      const saved = await api.replaceRows(id, { name: ds.name, description: ds.description, columns: ds.columns, rows: all });
      invalidate(id);
      print('ok', `✔ ${newRows.length} fila(s) añadida(s) a #${id}. Total: ${fmtNumber(saved.rowCount)} filas · ${STATUS_LABELS[saved.status]}.`);
      return;
    }
    case 'abrir':
      if (!Number(rest)) throw new Error('Uso: abrir <id>');
      await api.dataset(Number(rest));
      location.hash = `#/dashboard/${Number(rest)}`;
      return;
    case 'eliminar': {
      const [idText, word] = rest.split(/\s+/);
      if (!Number(idText)) throw new Error('Uso: eliminar <id> confirmar');
      const ds = await api.dataset(Number(idText));
      if ((word || '').toLowerCase() !== 'confirmar') throw new Error(`Para eliminar «${ds.name}» (${ds.rowCount} filas) escribe: eliminar ${ds.id} confirmar`);
      await api.deleteDataset(ds.id);
      invalidate(ds.id);
      print('ok', `✔ Conjunto #${ds.id} «${ds.name}» eliminado.`);
      return;
    }
    case 'demo': {
      const r = await api.loadDemo();
      print('ok', r.loaded.length ? `✔ Cargados: ${r.loaded.join(', ')}` : 'Los datos de demostración ya estaban cargados.');
      return;
    }
    default:
      throw new Error(`Comando desconocido «${cmd}». Escribe «ayuda» para ver los comandos.`);
  }
}

export function consoleView(main) {
  const out = h('div', { class: 'console-out', role: 'log', 'aria-live': 'polite', 'aria-label': 'Resultados de la consola' });
  const input = h('textarea', { class: 'console-in', rows: 1, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Comando', placeholder: 'Escribe un comando (p. ej. ayuda) y pulsa Enter' });
  let hIdx = session.history.length;

  function render(kind, a, b) {
    if (kind === 'table') {
      return h('div', { class: 'console-table' }, h('table', {},
        h('thead', {}, h('tr', {}, a.map((c) => h('th', {}, String(c))))),
        h('tbody', {}, b.map((r) => h('tr', {}, r.map((v) => h('td', {}, v === '' || v === null || v === undefined ? '—' : String(v))))))));
    }
    if (kind === 'help') return h('div', { class: 'console-line help' }, h('code', {}, a), h('span', {}, b));
    if (kind === 'link') return h('div', { class: 'console-line ok' }, '→ ', h('a', { href: b }, a));
    return h('div', { class: `console-line ${kind}` }, a);
  }

  function print(kind, a, b) {
    session.lines.push([kind, a, b]);
    out.append(render(kind, a, b));
    out.scrollTop = out.scrollHeight;
  }

  async function submit() {
    const text = input.value;
    if (!text.trim()) return;
    session.history.push(text);
    hIdx = session.history.length;
    input.value = '';
    autosize();
    print('cmd', `› ${text}`);
    input.disabled = true;
    try {
      if ((await runCommand(text, print)) === 'clear') clear(out);
    } catch (e) {
      print('err', `✖ ${e.message}`);
    } finally {
      input.disabled = false;
      input.focus();
    }
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(220, input.scrollHeight)}px`;
  }

  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'ArrowUp' && !input.value.includes('\n') && session.history.length) {
      e.preventDefault();
      hIdx = Math.max(0, hIdx - 1);
      input.value = session.history[hIdx];
    } else if (e.key === 'ArrowDown' && !input.value.includes('\n')) {
      e.preventDefault();
      hIdx = Math.min(session.history.length, hIdx + 1);
      input.value = session.history[hIdx] ?? '';
    }
  });

  const examples = [
    'nuevo Inventario tienda | producto, categoria, stock, precio',
    'fila Cuaderno, Papelería, 40, 5200',
    'fila Lápiz, Papelería, 120, 900\nBorrador, Papelería, 75, 600\nCalculadora, Tecnología, 12, 45000',
    'ver',
    'guardar Inventario cargado por consola',
  ];

  clear(main,
    h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', {}, 'Consola de datos'), h('span', { class: 'muted small' }, api.mode === 'server' ? 'Conectada al servidor local (SQLite)' : 'Modo navegador (datos en este navegador)')),
      h('p', { class: 'muted small' }, 'Ingresa datos escribiendo comandos. Enter ejecuta; Mayús+Enter agrega otra línea; ↑/↓ recorren el historial. Los valores se separan con comas (o punto y coma); usa comillas para valores que contengan comas.'),
      h('div', { class: 'console' }, out, h('div', { class: 'console-prompt' }, h('span', { 'aria-hidden': 'true' }, '›'), input,
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: submit }, 'Ejecutar'))),
      h('div', { class: 'console-examples' }, h('span', { class: 'muted small' }, 'Ejemplos (clic para copiar al campo):'),
        examples.map((ex) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { input.value = ex; autosize(); input.focus(); } }, ex.split('\n')[0] + (ex.includes('\n') ? ' …' : ''))))),
    h('section', { class: 'card' }, h('h3', {}, 'Consola de Node.js (solo versión local)'),
      h('p', { class: 'muted small' }, 'Con la aplicación instalada en tu equipo también puedes importar archivos completos desde la terminal:'),
      h('pre', { class: 'code' }, 'npm run import -- data/samples/proyectos.json --name "Proyectos TI"\nnpm run cli -- list')));

  if (!session.lines.length) print('info', 'Bienvenida a la consola de DataVision AI. Escribe «ayuda» para ver los comandos o prueba los ejemplos de abajo.');
  else for (const l of session.lines) out.append(render(...l));
  if (session.draft) print('info', `Tienes un conjunto en preparación: «${session.draft.name}» (${session.draft.rows.length} filas).`);
  out.scrollTop = out.scrollHeight;
  input.focus();
}
