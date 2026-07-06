// 门店月报模块共享类型

export type Brand = 'gelatomiiix' | 'bonjur' | 'xintiandi';

export interface StoreKpi {
  month: string; // YYYY-MM
  revenue_amt: number;
  cost_amt: number;
  expense_amt: number;
  hr_amt: number;
  rent_amt: number;
  gross_profit_amt: number;
  net_profit_amt: number;
  operating_cf_amt: number;
  total_in_amt: number;
  total_out_amt: number;
  cash_balance: number;
  loan_balance: number;
  cashflow_runway_months: number | null;
  hr_ratio_pct: number | null;
  rent_ratio_pct: number | null;
  gross_profit_rate_pct: number | null;
  net_profit_rate_pct: number | null;
  turnover_times: number | null;
}

export interface SnapshotResponse {
  current: StoreKpi;
  previous: StoreKpi | null;
}

export type KpiMetricKey =
  | 'revenue_amt'
  | 'expense_amt'
  | 'gross_profit_amt'
  | 'net_profit_amt'
  | 'operating_cf_amt'
  | 'cash_balance'
  | 'cashflow_runway_months'
  | 'hr_ratio_pct'
  | 'rent_ratio_pct'
  | 'gross_profit_rate_pct'
  | 'net_profit_rate_pct';

export const KPI_LABELS: Record<KpiMetricKey, string> = {
  revenue_amt: '营业收入',
  expense_amt: '营业支出',
  gross_profit_amt: '毛利',
  net_profit_amt: '净利润（不含分红）',
  operating_cf_amt: '经营现金流',
  cash_balance: '银行余额',
  cashflow_runway_months: '现金流月数',
  hr_ratio_pct: '人力占比率',
  rent_ratio_pct: '租金占比率',
  gross_profit_rate_pct: '毛利率',
  net_profit_rate_pct: '利润率',
};

// Excel 导出包含的更宽指标集（含中间量 cost_amt / hr_amt / rent_amt / loan_balance）
export type ExcelMetricKey =
  | KpiMetricKey
  | 'cost_amt'
  | 'hr_amt'
  | 'rent_amt'
  | 'loan_balance';

export const EXCEL_METRIC_LABELS: Record<ExcelMetricKey, string> = {
  ...KPI_LABELS,
  cost_amt: '营业成本',
  hr_amt: '人力',
  rent_amt: '租金',
  loan_balance: '贷款余额',
};

export interface TrendResponse {
  months: string[]; // YYYY-MM
  series: Record<KpiMetricKey, (number | null)[]>;
}

export interface ApiResult<T> {
  success: boolean;
  data: T | null;
  note?: string;
  error?: string;
}
