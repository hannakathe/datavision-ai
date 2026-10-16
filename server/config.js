import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const int = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

export const config = {
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'storage'),
  maxUploadMb: int(process.env.MAX_UPLOAD_MB, 5),
  maxRows: int(process.env.MAX_ROWS, 50000),
  maxColumns: int(process.env.MAX_COLUMNS, 200),
  maxCellLength: 5000,
  seedDemo: process.env.SEED_DEMO !== 'false',
};

export const dbFile = () => path.join(config.dataDir, 'datavision.sqlite');
