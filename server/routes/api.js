import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { badRequest, notFound } from '../errors.js';
import { publicImporters } from '../importers/index.js';
import * as svc from '../services/datasets.js';
import { seedDemo } from '../services/demo.js';
import { sanitizeConfig } from '../../public/js/core/dashboard.js';

const idParam = (v) => {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw badRequest('Identificador no válido.');
  return id;
};

export function apiRouter(store) {
  const r = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1, fields: 10 } });

  r.get('/health', (req, res) => res.json({ ok: true, datasets: store.listDatasets().length }));

  r.get('/importers', (req, res) => res.json({
    importers: publicImporters(),
    limits: { maxUploadMb: config.maxUploadMb, maxRows: config.maxRows, maxColumns: config.maxColumns },
  }));

  // Importación de archivos en dos pasos: vista previa → confirmación
  r.post('/import/preview', upload.single('archivo'), async (req, res) => {
    if (!req.file) throw badRequest('Selecciona un archivo para importar.');
    const filename = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json(await svc.createPreview({ buffer: req.file.buffer, filename, sheet: req.body?.sheet || undefined, table: req.body?.table || undefined }));
  });

  r.post('/import/commit', (req, res) => {
    res.status(201).json(svc.commitPreview(store, req.body || {}));
  });

  // Conjuntos de datos
  r.get('/datasets', (req, res) => res.json(store.listDatasets()));
  r.post('/datasets', (req, res) => res.status(201).json(svc.createManual(store, req.body || {})));

  r.get('/datasets/:id', (req, res) => res.json(svc.mustGet(store, idParam(req.params.id))));

  r.get('/datasets/:id/rows', (req, res) => {
    const id = idParam(req.params.id);
    const d = svc.mustGet(store, id);
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(config.maxRows, Math.max(1, Number(req.query.limit) || config.maxRows));
    res.json({ total: d.rowCount, offset, columns: d.columns, rows: store.getRows(id, offset, limit) });
  });

  r.patch('/datasets/:id', (req, res) => res.json(svc.updateDataset(store, idParam(req.params.id), req.body || {})));
  r.put('/datasets/:id/rows', (req, res) => res.json(svc.replaceManual(store, idParam(req.params.id), req.body || {})));
  r.post('/datasets/:id/clean', (req, res) => res.status(201).json(svc.cleanDataset(store, idParam(req.params.id), req.body || {})));
  r.post('/datasets/:id/query', (req, res) => res.json(svc.queryDataset(store, idParam(req.params.id), req.body || {})));

  r.get('/datasets/:id/export.csv', (req, res) => {
    const { name, csv } = svc.exportCsv(store, idParam(req.params.id));
    const safe = name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_') || 'datos';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safe)}.csv"`);
    res.send(`﻿${csv}`);
  });

  r.delete('/datasets/:id', (req, res) => {
    if (!store.deleteDataset(idParam(req.params.id))) throw notFound('El conjunto de datos no existe.');
    res.status(204).end();
  });

  // Configuraciones de dashboard guardadas
  r.get('/datasets/:id/dashboards', (req, res) => {
    const id = idParam(req.params.id);
    svc.mustGet(store, id);
    res.json(store.listDashboards(id));
  });

  r.post('/datasets/:id/dashboards', (req, res) => {
    const id = idParam(req.params.id);
    const d = svc.mustGet(store, id);
    const name = String(req.body?.name || '').trim().slice(0, 120);
    if (!name) throw badRequest('Escribe un nombre para la configuración.');
    const dashId = store.createDashboard(id, name, sanitizeConfig(req.body?.config, d.schema));
    res.status(201).json(store.getDashboard(dashId));
  });

  r.get('/dashboards/:id', (req, res) => {
    const dash = store.getDashboard(idParam(req.params.id));
    if (!dash) throw notFound('La configuración no existe.');
    res.json(dash);
  });

  r.put('/dashboards/:id', (req, res) => {
    const id = idParam(req.params.id);
    const dash = store.getDashboard(id);
    if (!dash) throw notFound('La configuración no existe.');
    const d = svc.mustGet(store, dash.datasetId);
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 120) : undefined;
    if (name === '') throw badRequest('El nombre no puede estar vacío.');
    store.updateDashboard(id, { name, config: req.body?.config ? sanitizeConfig(req.body.config, d.schema) : undefined });
    res.json(store.getDashboard(id));
  });

  r.delete('/dashboards/:id', (req, res) => {
    if (!store.deleteDashboard(idParam(req.params.id))) throw notFound('La configuración no existe.');
    res.status(204).end();
  });

  r.post('/demo/load', async (req, res) => {
    const loaded = await seedDemo(store);
    res.json({ loaded });
  });

  r.use((req, res) => res.status(404).json({ error: 'Ruta de la API no encontrada.' }));
  return r;
}
