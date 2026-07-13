import { ExcelMetricKey, KpiMetricKey } from './store-report-types';

export const ALL_METRICS: ExcelMetricKey[] = [
  'revenue_amt', 'cost_amt', 'expense_amt',
  'gross_profit_amt', 'gross_profit_rate_pct',
  'net_profit_amt', 'net_profit_rate_pct',
  'operating_cf_amt', 'cash_balance', 'loan_balance', 'cashflow_runway_months',
  'hr_amt', 'hr_ratio_pct',
  'rent_amt', 'rent_ratio_pct',
];

export const SERIES_KEYS: KpiMetricKey[] = [
  'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt',
  'operating_cf_amt', 'cash_balance', 'cashflow_runway_months',
  'hr_ratio_pct', 'rent_ratio_pct',
];

export const FMT_AMT = '\u00A5#,##0.00;(\u00A5#,##0.00)';
export const FMT_PCT = '0.0"%"';
export const FMT_MONTHS = '0.0';
export const FMT_DATE = 'yyyy-mm-dd';

export const FILL_HEADER = { patternType: 'solid', fgColor: { rgb: 'FFD9D9D9' } } as const;
export const FONT_HEADER = { bold: true, sz: 12 } as const;

export const ABS_VALUE_KEYS: ReadonlySet<ExcelMetricKey> = new Set<ExcelMetricKey>(['hr_amt', 'rent_amt']);
