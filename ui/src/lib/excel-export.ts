import * as XLSX from 'xlsx-js-style';
import type { SnapshotResponse, StoreKpi, TrendResponse } from './store-report-types';
import { ExcelMetricKey, EXCEL_METRIC_LABELS, KpiMetricKey, KPI_LABELS } from './store-report-types';

const ALL_METRICS: ExcelMetricKey[] = [
  'revenue_amt', 'cost_amt', 'expense_amt', 'hr_amt', 'rent_amt',
  'gross_profit_amt', 'gross_profit_rate_pct',
  'net_profit_amt', 'net_profit_rate_pct',
  'operating_cf_amt',
  'cash_balance', 'loan_balance', 'cashflow_runway_months',
  'hr_ratio_pct', 'rent_ratio_pct',
];

const SERIES_KEYS: KpiMetricKey[] = [
  'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt',
  'operating_cf_amt', 'cash_balance', 'cashflow_runway_months',
  'hr_ratio_pct', 'rent_ratio_pct',
];

const FMT_AMT = '¥#,##0.00;(¥#,##0.00)';
const FMT_PCT = '0.0"%"';
const FMT_MONTHS = '0.0';
const FMT_DATE = 'yyyy-mm-dd';

const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'FFD9D9D9' } } as const;
const FONT_HEADER = { bold: true, sz: 12 } as const;

function numFmtFor(key: ExcelMetricKey): string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct' || key === 'gross_profit_rate_pct' || key === 'net_profit_rate_pct') return FMT_PCT;
  if (key === 'cashflow_runway_months') return FMT_MONTHS;
  return FMT_AMT;
}

function roundForKey(key: ExcelMetricKey, v: number | null | undefined): number | null {
  if (v == null) return null;
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct' || key === 'gross_profit_rate_pct' || key === 'net_profit_rate_pct') {
    return Math.round(Number(v) * 10) / 10;
  }
  if (key === 'cashflow_runway_months') {
    return Math.round(Number(v) * 10) / 10;
  }
  return Math.round(Number(v) * 100) / 100;
}

export interface ExportInput {
  brand: string;
  store: string;
  month: string;
  generatedAt: Date;
  snapshot: SnapshotResponse;
  trend: TrendResponse;
}

// Sheet-scoped cell-formatter: row/col → numFmt
type CellFormats = Map<string, string>;

function setFmt(formats: CellFormats, row: number, col: number, numFmt: string): void {
  formats.set(XLSX.utils.encode_cell({ r: row, c: col }), numFmt);
}

function applyFormats(ws: XLSX.WorkSheet, formats: CellFormats): void {
  for (const [ref, numFmt] of formats) {
    if (ws[ref]) {
      if (!ws[ref].s) ws[ref].s = {};
      ws[ref].s.numFmt = numFmt;
    }
  }
}

function applyHeaderStyle(ws: XLSX.WorkSheet, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    if (ws[ref]) {
      ws[ref].s = { font: FONT_HEADER, fill: FILL_HEADER };
    }
  }
}

export function buildStoreReportWorkbook(input: ExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Sheet 1: 门店信息 (key-value, no header row)
  // Format the date as ISO string so xlsx-js-style doesn't auto-assign a
  // locale-dependent built-in numFmt (numFmtId=14 = m/d/yyyy).
  const generatedAtStr = input.generatedAt.toISOString().slice(0, 10);
  const infoRows: any[][] = [
    ['品牌', input.brand],
    ['门店', input.store],
    ['月份', input.month],
    ['生成时间', generatedAtStr],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(infoRows);
  ws1['!cols'] = [{ wch: 14 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws1, '门店信息');

  // Sheet 2: 当月快照
  const cur = input.snapshot.current;
  const prev = input.snapshot.previous;
  const snapRows: any[][] = [['指标', '当月值', '上月值', '环比%']];
  const snapFmts: CellFormats = new Map();
  for (let i = 0; i < ALL_METRICS.length; i++) {
    const key = ALL_METRICS[i];
    const curV = (cur as any)[key];
    const prevV = prev ? (prev as any)[key] : null;
    const row = i + 1;

    const curRounded = roundForKey(key, curV);
    const prevRounded = roundForKey(key, prevV);

    snapRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      curRounded,
      prevV == null ? '' : prevRounded,
      null,
    ]);
    setFmt(snapFmts, row, 1, numFmtFor(key));
    if (prevV != null) setFmt(snapFmts, row, 2, numFmtFor(key));

    if (prevV != null && curV != null && Number(prevV) !== 0) {
      const d = Math.round(((Number(curV) - Number(prevV)) / Math.abs(Number(prevV))) * 1000) / 10;
      snapRows[row][3] = d;
      setFmt(snapFmts, row, 3, FMT_PCT);
    }
  }
  const ws2 = XLSX.utils.aoa_to_sheet(snapRows);
  applyFormats(ws2, snapFmts);
  applyHeaderStyle(ws2, snapRows[0].length);
  ws2['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws2, '当月快照');

  // Sheet 3: 历史趋势
  const trendHeader = ['月份', ...ALL_METRICS.map(k => EXCEL_METRIC_LABELS[k] ?? k)];
  const trendRows: any[][] = [trendHeader];
  const trendFmts: CellFormats = new Map();
  for (let i = 0; i < input.trend.months.length; i++) {
    const row: any[] = [input.trend.months[i]];
    for (let j = 0; j < ALL_METRICS.length; j++) {
      const key = ALL_METRICS[j];
      const v = (input.trend.series as any)[key]?.[i];
      const rounded = roundForKey(key, v);
      row.push(rounded);
      setFmt(trendFmts, i + 1, j + 1, numFmtFor(key));
    }
    trendRows.push(row);
  }
  const ws3 = XLSX.utils.aoa_to_sheet(trendRows);
  applyFormats(ws3, trendFmts);
  applyHeaderStyle(ws3, trendRows[0].length);
  ws3['!cols'] = [
    { wch: 12 },
    ...Array(15).fill({ wch: 14 }),
  ];
  XLSX.utils.book_append_sheet(wb, ws3, '历史趋势');

  // Sheet 4: 同期对比 (当月 vs 去年同期)
  const yoy = (() => {
    const [y, m] = input.month.split('-').map(Number);
    return `${y - 1}-${String(m).padStart(2, '0')}`;
  })();
  const yoyIndex = input.trend.months.indexOf(yoy);
  const yoyKpi: StoreKpi | null = yoyIndex >= 0 ? {
    month: yoy,
    revenue_amt: input.trend.series.revenue_amt[yoyIndex] ?? 0,
    cost_amt: 0, expense_amt: input.trend.series.expense_amt[yoyIndex] ?? 0,
    hr_amt: 0, rent_amt: 0,
    gross_profit_amt: input.trend.series.gross_profit_amt[yoyIndex] ?? 0,
    net_profit_amt: input.trend.series.net_profit_amt[yoyIndex] ?? 0,
    operating_cf_amt: input.trend.series.operating_cf_amt[yoyIndex] ?? 0,
    total_in_amt: 0, total_out_amt: 0,
    cash_balance: input.trend.series.cash_balance[yoyIndex] ?? 0,
    loan_balance: 0,
    cashflow_runway_months: input.trend.series.cashflow_runway_months[yoyIndex] ?? null,
    hr_ratio_pct: input.trend.series.hr_ratio_pct[yoyIndex] ?? null,
    rent_ratio_pct: input.trend.series.rent_ratio_pct[yoyIndex] ?? null,
    gross_profit_rate_pct: input.trend.series.gross_profit_rate_pct?.[yoyIndex] ?? null,
    net_profit_rate_pct: input.trend.series.net_profit_rate_pct?.[yoyIndex] ?? null,
  } : null;

  const yoyRows: any[][] = [
    ['指标', `当月 (${input.month})`, `去年同期 (${yoy})`, '同比%'],
  ];
  const yoyFmts: CellFormats = new Map();
  for (let i = 0; i < SERIES_KEYS.length; i++) {
    const key = SERIES_KEYS[i];
    const curV = (cur as any)[key];
    const yoyV = yoyKpi ? (yoyKpi as any)[key] : null;
    const row = i + 1;

    const curRounded = roundForKey(key, curV);
    const yoyRounded = yoyV == null ? null : roundForKey(key, yoyV);

    yoyRows.push([
      KPI_LABELS[key] ?? key,
      curRounded,
      yoyV == null ? '(无数据)' : yoyRounded,
      null,
    ]);
    setFmt(yoyFmts, row, 1, numFmtFor(key));
    if (yoyV != null) setFmt(yoyFmts, row, 2, numFmtFor(key));

    if (yoyV != null && curV != null && Number(yoyV) !== 0) {
      const d = Math.round(((Number(curV) - Number(yoyV)) / Math.abs(Number(yoyV))) * 1000) / 10;
      yoyRows[row][3] = d;
      setFmt(yoyFmts, row, 3, FMT_PCT);
    }
  }
  const ws4 = XLSX.utils.aoa_to_sheet(yoyRows);
  applyFormats(ws4, yoyFmts);
  applyHeaderStyle(ws4, yoyRows[0].length);
  ws4['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, ws4, '同期对比');

  return wb;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(buf);
}
