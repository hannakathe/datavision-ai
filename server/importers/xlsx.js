import ExcelJS from 'exceljs';
import { parseXlsx as parse } from '../../public/js/core/parsers.js';

export const parseXlsx = (buffer, opts) => parse(buffer, ExcelJS, opts);
