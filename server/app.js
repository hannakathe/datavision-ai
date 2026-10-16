import path from 'node:path';
import express from 'express';
import { ROOT } from './config.js';
import { apiRouter } from './routes/api.js';
import { errorHandler } from './errors.js';

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
}

export function createApp(store) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', apiRouter(store));
  app.use('/vendor/chart.js', express.static(path.join(ROOT, 'node_modules', 'chart.js', 'dist')));
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));
  app.use(errorHandler);
  return app;
}
