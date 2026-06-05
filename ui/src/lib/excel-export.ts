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

// 给任意一行（不一定是 row 0）加粗 + 浅灰底色，用于多 section 单 sheet 场景
function applyHeaderStyleAt(ws: XLSX.WorkSheet, row: number, colCount: number): void {
  for (let c = 0; c < colCount; c++) {
    const ref = XLSX.utils.encode_cell({ r: row, c });
    if (ws[ref]) {
      ws[ref].s = { font: FONT_HEADER, fill: FILL_HEADER };
    }
  }
}

// 把多个 section (每段有自己的 rows + per-section CellFormats) 合并成单 sheet 的行数组。
// 返回合并后的 rows、全局 cell formats（已按行号偏移）、以及每个 section title 行的全局行号。
//
// 各段 cell formats 里的 ref 是基于该段「第一个数据行」起的相对行号（1-based），即
// `setFmt(fmts, row, col, ...)` 中的 row=1 对应该段第一行数据。本函数在合并时
// 按 section 在全局 sheet 中的起始行号整体偏移，保证 numFmt 仍能正确落到对应 cell。
function buildAllRows(
  sections: Array<{ title: string; rows: any[][]; fmts: CellFormats }>
): { rows: any[][]; allFmts: CellFormats; headerRowIndices: number[] } {
  const rows: any[][] = [];
  const allFmts: CellFormats = new Map();
  const headerRowIndices: number[] = [];
  let cursor = 0;

  sections.forEach((section, i) => {
    headerRowIndices.push(cursor);
    rows.push([section.title]);
    cursor += 1;
    rows.push(...section.rows);
    cursor += section.rows.length;

    // 段首在全局 sheet 里的 0-indexed 行号 = cursor - section.rows.length - 1
    // 对任意相对行 r (1-based)，全局 0-indexed 行 = sectionStart + r
    // xlsx cell ref 是 1-indexed（如 "B9" 表示 1-indexed 第 9 行），所以写入时 +1
    const sectionStart = cursor - section.rows.length - 1;
    for (const [ref, numFmt] of section.fmts) {
      const m = ref.match(/^([A-Z]+)(\d+)$/);
      if (m) {
        const col = m[1];
        const relativeRow = Number(m[2]);
        const globalRow = sectionStart + relativeRow;
        allFmts.set(`${col}${globalRow + 1}`, numFmt);
      }
    }

    if (i < sections.length - 1) {
      rows.push([]);
      cursor += 1;
    }
  });

  return { rows, allFmts, headerRowIndices };
}

export function buildStoreReportWorkbook(input: ExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // Format the date as ISO string so xlsx-js-style doesn't auto-assign a
  // locale-dependent built-in numFmt (numFmtId=14 = m/d/yyyy).
  const generatedAtStr = input.generatedAt.toISOString().slice(0, 10);

  // 段 1: 门店信息 (key-value, no header row)
  const infoRows: any[][] = [
    ['品牌', input.brand],
    ['门店', input.store],
    ['月份', input.month],
    ['生成时间', generatedAtStr],
  ];

  // 段 2: 当月快照
  const cur = input.snapshot.current;
  const prev = input.snapshot.previous;
  const snapHeader = ['指标', '当月值', '上月值', '环比%'];
  const snapRows: any[][] = [snapHeader];
  const snapFmts: CellFormats = new Map();
  for (let i = 0; i < ALL_METRICS.length; i++) {
    const key = ALL_METRICS[i];
    const curV = (cur as any)[key];
    const prevV = prev ? (prev as any)[key] : null;
    const row = i + 1;
    snapRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      roundForKey(key, curV),
      prevV == null ? '' : roundForKey(key, prevV),
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

  // 段 4 (后于段 3 输出): 同期对比
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

  const yoyHeader = ['指标', `当月 (${input.month})`, `去年同期 (${yoy})`, '同比%'];
  const yoyRows: any[][] = [yoyHeader];
  const yoyFmts: CellFormats = new Map();
  for (let i = 0; i < SERIES_KEYS.length; i++) {
    const key = SERIES_KEYS[i];
    const curV = (cur as any)[key];
    const yoyV = yoyKpi ? (yoyKpi as any)[key] : null;
    const row = i + 1;
    yoyRows.push([
      KPI_LABELS[key] ?? key,
      roundForKey(key, curV),
      yoyV == null ? '(无数据)' : roundForKey(key, yoyV),
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

  // 段 3: 历史趋势
  const trendHeader = ['月份', ...ALL_METRICS.map(k => EXCEL_METRIC_LABELS[k] ?? k)];
  const trendRows: any[][] = [trendHeader];
  const trendFmts: CellFormats = new Map();
  for (let i = 0; i < input.trend.months.length; i++) {
    const row: any[] = [input.trend.months[i]];
    for (let j = 0; j < ALL_METRICS.length; j++) {
      const key = ALL_METRICS[j];
      const v = (input.trend.series as any)[key]?.[i];
      row.push(roundForKey(key, v));
      setFmt(trendFmts, i + 1, j + 1, numFmtFor(key));
    }
    trendRows.push(row);
  }

  // 合并为单 sheet (顺序 1→2→4→3，段间空 1 行)
  const sections = [
    { title: '门店信息', rows: infoRows, fmts: new Map<string, string>() as CellFormats },
    { title: '当月快照', rows: snapRows, fmts: snapFmts },
    { title: '同期对比', rows: yoyRows, fmts: yoyFmts },
    { title: '历史趋势', rows: trendRows, fmts: trendFmts },
  ];

  const { rows, allFmts, headerRowIndices } = buildAllRows(sections);
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 应用 numFmt 到所有 cell
  applyFormats(ws, allFmts);

  // 段头 (title) 行 + 段 2-4 列头行 加粗 + 浅灰底色
  // 段 1 没有 column header 行 (key-value 列表)
  for (let i = 0; i < headerRowIndices.length; i++) {
    const titleRow = headerRowIndices[i];
    const colCount = sections[i].rows[0].length;
    applyHeaderStyleAt(ws, titleRow, colCount);
    if (i > 0) {
      applyHeaderStyleAt(ws, titleRow + 1, colCount);
    }
  }

  // 列宽：取所有 section 中最宽的 (16 列 for 历史趋势)
  ws['!cols'] = [
    { wch: 22 },  // A: 指标/月份
    { wch: 18 },  // B
    { wch: 18 },  // C
    { wch: 10 },  // D
    ...Array(12).fill({ wch: 14 }),  // E-P: 12 列
  ];

  XLSX.utils.book_append_sheet(wb, ws, '门店月报');
  return wb;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(buf);
}
