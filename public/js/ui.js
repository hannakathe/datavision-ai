// Utilidades de interfaz: creación segura de elementos (siempre textContent), avisos, diálogos y tablas.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

export function icon(name) {
  const paths = {
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
    upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3',
    table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
    db: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6m16 6c0 1.7-3.6 3-8 3s-8-1.3-8-3',
    chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
    spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
    trash: 'M4 7h16M9 7V4h6v3m-8 0l1 13h8l1-13',
    edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    filter: 'M3 5h18l-7 8v6l-4 2v-8z',
    plus: 'M12 5v14M5 12h14',
    save: 'M5 3h11l3 3v15H5zM8 3v6h8M8 21v-7h8v7',
    download: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
    x: 'M6 6l12 12M18 6L6 18',
    gear: 'M4 6h9m4 0h3M4 12h3m4 0h9M4 18h11m4 0h1M15 4v4M9 10v4M17 16v4',
    menu: 'M4 6h16M4 12h16M4 18h16',
    eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
    info: 'M12 8h.01M11 12h1v5h1M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', paths[name] || paths.info);
  svg.append(p);
  return svg;
}

export function toast(message, type = 'info') {
  const region = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, message);
  region.append(t);
  setTimeout(() => t.classList.add('out'), 4200);
  setTimeout(() => t.remove(), 4700);
}

// Diálogo modal accesible basado en <dialog>. Resuelve con el valor del botón o null al cancelar.
export function dialog({ title, body, actions = [{ label: 'Aceptar', value: true, primary: true }], cancel = 'Cancelar' }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'modal', 'aria-labelledby': 'modal-title' });
    const form = h('form', { method: 'dialog' });
    const footer = h('div', { class: 'modal-actions' });
    if (cancel) footer.append(h('button', { type: 'submit', value: '', class: 'btn btn-ghost' }, cancel));
    for (const a of actions) footer.append(h('button', { type: 'submit', value: String(a.value), class: `btn ${a.danger ? 'btn-danger' : a.primary ? 'btn-primary' : 'btn-ghost'}` }, a.label));
    form.append(h('h2', { id: 'modal-title' }, title), h('div', { class: 'modal-body' }, body), footer);
    d.append(form);
    document.body.append(d);
    d.addEventListener('close', () => {
      const v = d.returnValue;
      d.remove();
      const match = actions.find((a) => String(a.value) === v);
      resolve(match ? match.value : null);
    });
    d.showModal();
    footer.querySelector('.btn-primary, .btn-danger')?.focus();
  });
}

export async function confirmAction(title, message, label = 'Eliminar') {
  return (await dialog({ title, body: h('p', {}, message), actions: [{ label, value: true, danger: true }] })) === true;
}

export async function promptText(title, label, value = '') {
  const input = h('input', { type: 'text', class: 'input', value, maxlength: 120, required: true, 'aria-label': label });
  const body = h('label', { class: 'field' }, h('span', {}, label), input);
  setTimeout(() => { input.focus(); input.select(); }, 30);
  const ok = await dialog({ title, body, actions: [{ label: 'Guardar', value: 'ok', primary: true }] });
  return ok === 'ok' ? input.value.trim() : null;
}

export function loading(text = 'Cargando…') {
  return h('div', { class: 'loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function emptyState(title, text, ...actions) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-art', 'aria-hidden': 'true' }, icon('chart')), h('h3', {}, title), h('p', {}, text), h('div', { class: 'empty-actions' }, actions));
}

export function badge(text, kind = 'neutral') {
  return h('span', { class: `badge badge-${kind}` }, text);
}

export function cellText(v) {
  if (v === null || v === undefined || v === '') return '';
  return typeof v === 'boolean' ? (v ? 'verdadero' : 'falso') : String(v);
}

// Tabla de datos con encabezados ordenables opcionales.
export function dataTable(columns, rows, { sort, onSort, caption, types = {} } = {}) {
  const thead = h('thead', {}, h('tr', {}, columns.map((c) => {
    const dir = sort?.column === c ? sort.dir : null;
    const label = [c, dir ? (dir === 'asc' ? ' ▲' : ' ▼') : ''];
    return h('th', { scope: 'col', 'aria-sort': dir ? (dir === 'asc' ? 'ascending' : 'descending') : null, class: types[c] === 'numerico' ? 'num' : null },
      onSort ? h('button', { type: 'button', class: 'th-btn', onclick: () => onSort(c) }, label) : label);
  })));
  const tbody = h('tbody', {}, rows.map((r) => h('tr', {}, columns.map((c) => {
    const v = r[c];
    const empty = v === null || v === undefined || v === '';
    return h('td', { class: [types[c] === 'numerico' ? 'num' : '', empty ? 'muted' : ''].join(' ').trim() || null }, empty ? '—' : cellText(v));
  }))));
  return h('div', { class: 'table-wrap', tabindex: '0', role: 'region', 'aria-label': caption || 'Tabla de datos' }, h('table', { class: 'table' }, caption ? h('caption', { class: 'sr-only' }, caption) : null, thead, tbody));
}

export function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* almacenamiento no disponible */ }
}
