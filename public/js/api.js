// Cliente HTTP de la API con mensajes de error en español.
async function request(method, url, body, { isForm = false } = {}) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new Error('No se pudo conectar con el servidor. ¿Está en ejecución (npm start)?');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  importers: () => request('GET', '/api/importers'),
  preview: (form) => request('POST', '/api/import/preview', form, { isForm: true }),
  commit: (body) => request('POST', '/api/import/commit', body),
  datasets: () => request('GET', '/api/datasets'),
  dataset: (id) => request('GET', `/api/datasets/${id}`),
  rows: (id, limit) => request('GET', `/api/datasets/${id}/rows${limit ? `?limit=${limit}` : ''}`),
  createDataset: (body) => request('POST', '/api/datasets', body),
  replaceRows: (id, body) => request('PUT', `/api/datasets/${id}/rows`, body),
  updateDataset: (id, body) => request('PATCH', `/api/datasets/${id}`, body),
  cleanDataset: (id, body) => request('POST', `/api/datasets/${id}/clean`, body),
  deleteDataset: (id) => request('DELETE', `/api/datasets/${id}`),
  dashboards: (id) => request('GET', `/api/datasets/${id}/dashboards`),
  saveDashboard: (id, body) => request('POST', `/api/datasets/${id}/dashboards`, body),
  updateDashboard: (id, body) => request('PUT', `/api/dashboards/${id}`, body),
  deleteDashboard: (id) => request('DELETE', `/api/dashboards/${id}`),
  loadDemo: () => request('POST', '/api/demo/load'),
};
