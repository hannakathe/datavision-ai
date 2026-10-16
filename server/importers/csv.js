import Papa from 'papaparse';
import { badRequest } from '../errors.js';

export function decodeText(buffer) {
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('�')) text = new TextDecoder('latin1').decode(buffer); // archivos guardados desde Excel en ANSI
  return text.replace(/^﻿/, '');
}

const PAPA_MESSAGES = {
  MissingQuotes: 'comillas sin cerrar',
  InvalidQuotes: 'comillas mal formadas',
  UndetectableDelimiter: 'no se pudo detectar el separador',
};

export function parseCsv(buffer) {
  const text = decodeText(buffer);
  if (!text.trim()) throw badRequest('El archivo está vacío.');
  if (text.includes('\u0000')) throw badRequest('El archivo parece binario; no es un CSV de texto.');
  const res = Papa.parse(text, { skipEmptyLines: 'greedy', delimitersToGuess: [',', ';', '\t', '|'] });
  if (!res.data.length) throw badRequest('El archivo no contiene filas.');
  const [header, ...body] = res.data;
  const warnings = [];
  const relevant = res.errors.filter((e) => PAPA_MESSAGES[e.code] && !(e.code === 'UndetectableDelimiter' && header.length === 1));
  if (relevant.length) {
    warnings.push(`Problemas de formato: ${relevant.slice(0, 3).map((e) => `${PAPA_MESSAGES[e.code]}${e.row !== undefined ? ` (fila ${e.row + 2})` : ''}`).join('; ')}${relevant.length > 3 ? '…' : ''}.`);
  }
  const short = body.filter((r) => r.length < header.length).length;
  if (short) warnings.push(`${short} fila(s) tienen menos valores que encabezados; las celdas faltantes quedan vacías.`);
  if (header.length === 1 && body.length) warnings.push('Solo se detectó una columna. Si esperabas varias, revisa el separador (coma, punto y coma o tabulación).');
  return { columns: header, rows: body, warnings, meta: { delimiter: res.meta.delimiter } };
}
