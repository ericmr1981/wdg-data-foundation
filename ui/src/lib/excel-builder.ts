import * as XLSX from 'xlsx-js-style';
import type { SnapshotResponse, StoreKpi, TrendResponse } from './store-report-types';
import { EXCEL_METRIC_LABELS, KPI_LABELS } from './store-report-types';
import { ALL_METRICS, SERIES_KEYS, FMT_PCT } from './excel-config';
import { roundForKey, numFmtFor, setFmt, applyFormats, applyHeaderStyleAt } from './excel-formats';
import type { CellFormats } from './excel-formats';

export interface ExportInput {
  brand: string;
  store: string;
  month: string;
  generatedAt: Date;
  snapshot: SnapshotResponse;
  trend: TrendResponse;
}

export function buildAllRows(
  sections: Array<{ title: string; rows: unknown[][]; fmts: CellFormats }>
): { rows: unknown[][]; allFmts: CellFormats; headerRowIndices: number[] } {
  const rows: unknown[][] = [];
  const allFmts: CellFormats = new Map();
  const headerRowIndices: number[] = [];
  let cursor = 0;

  sections.forEach((section, i) => {
    headerRowIndices.push(cursor);
    rows.push([section.title]);
    cursor += 1;
    rows.push(...section.rows);
    cursor += section.rows.length;

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
  const generatedAtStr = input.generatedAt.toISOString().slice(0, 10);

  const infoRows: unknown[][] = [
    ['\u54C1\u724C', input.brand],
    ['\u95E8\u5E97', input.store],
    ['\u6708\u4EFD', input.month],
    ['\u751F\u6210\u65F6\u95F4', generatedAtStr],
  ];

  const cur = input.snapshot.current;
  const prev = input.snapshot.previous;
  const snapHeader = ['\u6307\u6807', '\u5F53\u6708\u503C', '\u4E0A\u6708\u503C', '\u73AF\u6BD4%'];
  const snapRows: unknown[][] = [snapHeader];
  const snapFmts: CellFormats = new Map();
  for (let i = 0; i < ALL_METRICS.length; i++) {
    const key = ALL_METRICS[i];
    const curV = (cur as any)[key];
    const prevV = prev ? (prev as any)[key] : null;
    const row = i + 1;
    snapRows.push([
      EXCEL_METRIC_LABELS[key] ?? key,
      roundForKey(key, curV as number | null | undefined),
      prevV == null ? '' : roundForKey(key, prevV as number | null | undefined),
      null,
    ]);
    setFmt(snapFmts, row, 1, numFmtFor(key));
    if (prevV != null) setFmt(snapFmts, row, 2, numFmtFor(key));
    if (prevV != null && curV != null && Number(prevV) !== 0) {
      const d = Math.round(((Number(curV) - Number(prevV)) / Math.abs(Number(prevV))) * 1000) / 10;
      (snapRows[row] as unknown[])[3] = d;
      setFmt(snapFmts, row, 3, FMT_PCT);
    }
  }

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
    turnover_times: null,
  } : null;

  const yoyHeader = ['\u6307\u6807', `\u5F53\u6708 (${input.month})`, `\u540C\u671F (${yoy})`, '\u540C\u6BD4%'];
  const yoyRows: unknown[][] = [yoyHeader];
  const yoyFmts: CellFormats = new Map();
  for (let i = 0; i < SERIES_KEYS.length; i++) {
    const key = SERIES_KEYS[i];
    const curV = (cur as any)[key];
    const yoyV = yoyKpi ? (yoyKpi as any)[key] : null;
    const row = i + 1;
    yoyRows.push([
      KPI_LABELS[key] ?? key,
      roundForKey(key, curV as number | null | undefined),
      yoyV == null ? '(\u65E0\u6570\u636E)' : roundForKey(key, yoyV as number | null | undefined),
      null,
    ]);
    setFmt(yoyFmts, row, 1, numFmtFor(key));
    if (yoyV != null) setFmt(yoyFmts, row, 2, numFmtFor(key));
    if (yoyV != null && curV != null && Number(yoyV) !== 0) {
      const d = Math.round(((Number(curV) - Number(yoyV)) / Math.abs(Number(yoyV))) * 1000) / 10;
      (yoyRows[row] as unknown[])[3] = d;
      setFmt(yoyFmts, row, 3, FMT_PCT);
    }
  }

  const trendHeader = ['\u6708\u4EFD', ...ALL_METRICS.map(k => EXCEL_METRIC_LABELS[k] ?? k)];
  const trendRows: unknown[][] = [trendHeader];
  const trendFmts: CellFormats = new Map();
  for (let i = 0; i < input.trend.months.length; i++) {
    const row: unknown[] = [input.trend.months[i]];
    for (let j = 0; j < ALL_METRICS.length; j++) {
      const key = ALL_METRICS[j];
      const v = (input.trend.series as Record<string, (number | null)[] | undefined>)[key]?.[i];
      row.push(roundForKey(key, v));
      setFmt(trendFmts, i + 1, j + 1, numFmtFor(key));
    }
    trendRows.push(row);
  }

  const sections = [
    { title: '\u95E8\u5E97\u4FE1\u606F', rows: infoRows, fmts: new Map<string, string>() as CellFormats },
    { title: '\u5F53\u6708\u5FEB\u7167', rows: snapRows, fmts: snapFmts },
    { title: '\u540C\u671F\u5BF9\u6BD4', rows: yoyRows, fmts: yoyFmts },
    { title: '\u5386\u53F2\u8D8B\u52BF', rows: trendRows, fmts: trendFmts },
  ];

  const { rows, allFmts, headerRowIndices } = buildAllRows(sections);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  applyFormats(ws, allFmts);

  for (let i = 0; i < headerRowIndices.length; i++) {
    const titleRow = headerRowIndices[i];
    const colCount = sections[i].rows[0].length;
    applyHeaderStyleAt(ws, titleRow, colCount);
    if (i > 0) {
      applyHeaderStyleAt(ws, titleRow + 1, colCount);
    }
  }

  ws['!cols'] = [
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 10 },
    ...Array(12).fill({ wch: 14 }),
  ];

  XLSX.utils.book_append_sheet(wb, ws, '\u95E8\u5E97\u6708\u62A5');
  return wb;
}
