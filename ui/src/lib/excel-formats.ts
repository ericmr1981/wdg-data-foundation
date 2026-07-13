import * as XLSX from 'xlsx-js-style';
import { ExcelMetricKey } from './store-report-types';
import { FMT_AMT, FMT_PCT, FMT_MONTHS, FILL_HEADER, FONT_HEADER, ABS_VALUE_KEYS } from './excel-config';

export function numFmtFor(key: ExcelMetricKey): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct' || key === 'gross_profit_rate_pct' || key === 'net_profit_rate_pct') return FMT_PCT;
  if (key === 'cashflow_runway_months') return FMT_MONTHS;
  return FMT_AMT;
}

export function roundForKey(key: ExcelMetricKey, v: number | null | undefined): number | null {
  if (v == null) return null;
  const raw = ABS_VALUE_KEYS.has(key) ? Math.abs(Number(v)) : Number(v);
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct' || key === 'gross_profit_rate_pct' || key === 'net_profit_rate_pct') {
    return Math.round(raw * 10) / 10;
  }
  if (key === 'cashflow_runway_months') {
    return Math.round(raw * 10) / 10;
  }
  return Math.round(raw * 100) / 100;
}

export type CellFormats = Map<string, string>;

export function setFmt(formats: CellFormats, row: number, col: number, numFmt: string): void {
  formats.set(XLSX.utils.encode_cell({ r: row, c: col }), numFmt);
}

export function applyFormats(ws: XLSX.WorkSheet, formats: CellFormats): void {
  for (const [ref, numFmt] of formats) {
    if (ws[ref]) {
      if (!ws[ref].s) ws[ref].s = {};
      ws[ref].s.numFmt = numFmt;
    }
  }
}

export function applyHeaderStyle(ws: XLSX.WorkSheet, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) {
      ws[ref].s = { font: FONT_HEADER, fill: FILL_HEADER };
    }
  }
}

export function applyHeaderStyleAt(ws: XLSX.WorkSheet, row: number, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: row, c });
    if (ws[ref]) {
      ws[ref].s = { font: FONT_HEADER, fill: FILL_HEADER };
    }
  }
}
