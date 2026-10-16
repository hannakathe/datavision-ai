import ExcelJS from 'exceljs';
import { badRequest } from '../errors.js';

function isoFromDate(d) {
  const iso = d.toISOString();
  return d.getUTCHours() || d.getUTCMinutes() || d.getUTCSeconds() ? iso.slice(0, 19) : iso.slice(0, 10);
}

function cellValue(v, stats) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoFromDate(v);
  if (typeof v !== 'object') return v;
  if ('formula' in v || 'sharedFormula' in v) { stats.formulas++; return cellValue(v.result, stats); }
  if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
  if ('text' in v) return typeof v.text === 'string' ? v.text : cellValue(v.text, stats);
  if ('error' in v) { stats.errors++; return null; }
  return String(v);
}

export async function parseXlsx(buffer, { sheet } = {}) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw badRequest('No se pudo leer el archivo XLSX: puede estar dañado o tener otro formato. Los archivos .xls antiguos no son compatibles; guárdalos como .xlsx o CSV.');
  }
  const sheets = wb.worksheets.map((ws) => ws.name);
  if (!sheets.length) throw badRequest('El libro no contiene hojas.');
  let ws;
  if (sheet) {
    ws = wb.getWorksheet(sheet);
    if (!ws) throw badRequest(`La hoja «${sheet}» no existe. Hojas disponibles: ${sheets.join(', ')}.`);
  } else {
    ws = wb.worksheets.find((w) => w.actualRowCount > 0) || wb.worksheets[0];
  }
  const stats = { formulas: 0, errors: 0 };
  const rows = [];
  let width = 0;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = [];
    for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value, stats));
    for (let c = vals.length - 1; c >= 0; c--) if (vals[c] !== null && vals[c] !== '') { width = Math.max(width, c + 1); break; }
    rows.push(vals);
  });
  if (!rows.length) throw badRequest(`La hoja «${ws.name}» está vacía.`);
  const trimmed = rows.map((r) => r.slice(0, width));
  const warnings = [];
  if (stats.formulas) warnings.push(`${stats.formulas} celda(s) contenían fórmulas: se importó solo el valor calculado; las fórmulas no se ejecutan.`);
  if (stats.errors) warnings.push(`${stats.errors} celda(s) contenían errores de Excel (#DIV/0!, #N/A…) y quedaron vacías.`);
  if (sheets.length > 1) warnings.push(`El libro tiene ${sheets.length} hojas; se importó «${ws.name}». Puedes elegir otra hoja.`);
  return { columns: trimmed[0], rows: trimmed.slice(1), warnings, meta: { sheets, sheet: ws.name } };
}
