// Adaptador del servidor: aplica los límites configurados al núcleo compartido de ingesta.
import { config } from '../config.js';
import { buildDataset as build, normalizeHeaders, revalidate } from '../../public/js/core/ingest.js';

export { normalizeHeaders, revalidate };
export const buildDataset = (input) => build(input, config);
