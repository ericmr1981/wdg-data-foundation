import * as XLSX from 'xlsx-js-style';

export { ALL_METRICS, SERIES_KEYS, FMT_AMT, FMT_PCT, FMT_MONTHS, FMT_DATE, FILL_HEADER, FONT_HEADER, ABS_VALUE_KEYS } from './excel-config';
export { numFmtFor, roundForKey, setFmt, applyFormats, applyHeaderStyle, applyHeaderStyleAt } from './excel-formats';
export type { CellFormats } from './excel-formats';
export { buildStoreReportWorkbook, buildAllRows } from './excel-builder';
export type { ExportInput } from './excel-builder';

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(buf);
}
