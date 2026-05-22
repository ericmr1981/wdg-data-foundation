/** Typed row interfaces for database query results */

export interface ProfitRow {
  lvl1_code: string;
  amount: string;
}

export interface CashflowRow {
  activity: string;
  net_amount: string;
}

export interface BalanceSheetRow {
  cash_balance: string;
}

export interface CoverageRow {
  month: string;
  total_rows: number;
  covered_rows: number;
  unclassified_rows: number;
  coverage_rate_rows: number;
  total_in_amt: number;
  covered_in_amt: number;
  unclassified_in_amt: number;
  coverage_rate_in_amt: number;
  total_out_amt: number;
  covered_out_amt: number;
  unclassified_out_amt: number;
  coverage_rate_out_amt: number;
}

export interface StoreRow {
  store_code: string;
  store_name: string;
}

export interface FileRow {
  id: number;
  file_name: string;
  file_path: string;
  store_code: string;
  month: string;
  status: string;
}

export interface MatchRow {
  [key: string]: unknown;
}

export interface PipelineStepRow {
  step_id: number;
  run_id: string;
  step_name: string;
  status: string;
  step_order: number;
  started_at: string;
  finished_at: string | null;
  rows_in: number | null;
  rows_out: number | null;
  error_message: string | null;
}

export interface PipelineRunRow {
  run_id: string;
  brand_code: string;
  store_code: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  month: string | null;
  triggered_by: string;
}

export interface CountRow {
  cnt: string;
}

/** Helper to format a DB error message without relying on `any` */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as Record<string, string>).message;
  }
  return 'Unknown error';
}
