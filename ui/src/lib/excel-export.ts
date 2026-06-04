import * as XLSX from 'xlsx';
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

function fmtAmt(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 100) / 100;
}

function fmtPct(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 10) / 10;
}

function fmtMonths(n: number | null | undefined): number | string {
  if (n == null) return '';
  return Math.round(Number(n) * 10) / 10;
}

function fmtCell(key: ExcelMetricKey, v: number | null | undefined): number | string {
  if (key === 'hr_ratio_pct' || key === 'rent_ratio_pct' || key === 'gross_profit_rate_pct' || key === 'net_profit_rate_pct') return fmtPct(v);
  if (key === 'cashflow_runway_months') return fmtMonths(v);
  return fmtAmt(v);
}

export interface ExportInput {
  brand: string;
  store: string;
  month: string;
  generatedAt: Date;
  snapshot: SnapshotResponse;
  trend: TrendResponse;
}

export function buildStoreReportWorkbook(input: ExportInput): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 段 2: 当月快照（保留原 snapRows 构建逻辑）
  const cur = input.snapshot.current;
  const prev = input.snapshot.previous;
  const snapRows: any[][] = [['指标', '当月值', '上月值', '环比%']];
  for (const key of ALL_METRICS) {
    const curV = (cur as any)[key];
    const prevV = prev ? (prev as any)[key] : null;
    let delta: number | string = '';
    if (prevV != null && curV != null && Number(prevV) !== 0) {
      delta = Math.round(((Number(curV) - Number(prevV)) / Math.abs(Number(prevV))) * 1000) / 10;
    }
    snapRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      fmtCell(key, curV),
      prevV == null ? '' : fmtCell(key, prevV),
      delta,
    ]);
  }

  // 段 4: 同期对比（保留原 yoyRows 构建逻辑）
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
  for (const key of SERIES_KEYS) {
    const curV = (cur as any)[key];
    const yoyV = yoyKpi ? (yoyKpi as any)[key] : null;
    let delta: number | string = '';
    if (yoyV != null && curV != null && Number(yoyV) !== 0) {
      delta = Math.round(((Number(curV) - Number(yoyV)) / Math.abs(Number(yoyV))) * 1000) / 10;
    }
    yoyRows.push([
      KPI_LABELS[key] ?? key,
      fmtCell(key, curV),
      yoyV == null ? '(无数据)' : fmtCell(key, yoyV),
      delta,
    ]);
  }

  // 段 3: 历史趋势（保留原 trendRows 构建逻辑）
  const trendHeader = ['月份', ...ALL_METRICS.map(k => EXCEL_METRIC_LABELS[k] ?? k)];
  const trendRows: any[][] = [trendHeader];
  for (let i = 0; i < input.trend.months.length; i++) {
    const row: any[] = [input.trend.months[i]];
    for (const key of ALL_METRICS) {
      const v = (input.trend.series as any)[key]?.[i];
      row.push(fmtCell(key, v));
    }
    trendRows.push(row);
  }

  // 合并为单 sheet
  const sections: Array<{ title: string; rows: any[][] }> = [
    {
      title: '门店信息',
      rows: [
        ['品牌', input.brand],
        ['门店', input.store],
        ['月份', input.month],
        ['生成时间', input.generatedAt.toISOString()],
      ],
    },
    { title: '当月快照', rows: snapRows },
    { title: '同期对比', rows: yoyRows },
    { title: '历史趋势', rows: trendRows },
  ];

  const { rows, headerRowIndices } = buildAllRows(sections);
  const ws = XLSX.utils.aoa_to_sheet(rows);

  for (const rowIdx of headerRowIndices) {
    const ref = XLSX.utils.encode_cell({ r: rowIdx, c: 0 });
    if (ws[ref]) ws[ref].s = { font: { bold: true, sz: 12 } };
  }

  XLSX.utils.book_append_sheet(wb, ws, '门店月报');
  return wb;
}

function buildAllRows(sections: Array<{ title: string; rows: any[][] }>): {
  rows: any[][];
  headerRowIndices: number[];
} {
  const rows: any[][] = [];
  const headerRowIndices: number[] = [];
  let cursor = 0;

  sections.forEach((section, i) => {
    headerRowIndices.push(cursor);
    rows.push([section.title]);
    cursor += 1;
    rows.push(...section.rows);
    cursor += section.rows.length;
    if (i < sections.length - 1) {
      rows.push([]);
      cursor += 1;
    }
  });

  return { rows, headerRowIndices };
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });
  return Buffer.from(buf);
}
