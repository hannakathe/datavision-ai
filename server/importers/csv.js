import Papa from 'papaparse';
import { parseCsv as parse, decodeText } from '../../public/js/core/parsers.js';

export { decodeText };
export const parseCsv = (buffer) => parse(buffer, Papa);
