import { config, dbFile } from './config.js';
import { Store } from './db.js';
import { createApp } from './app.js';
import { seedDemo } from './services/demo.js';

const store = new Store(dbFile());

if (config.seedDemo && !store.getMeta('demo_seeded')) {
  const loaded = await seedDemo(store);
  if (loaded.length) console.log(`Datos de demostración cargados: ${loaded.join(', ')}`);
}

const server = createApp(store).listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`DataVision AI disponible en http://${host}:${config.port}`);
  console.log(`Base de datos SQLite local: ${dbFile()}`);
});

const shutdown = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
