// Pipeline types
export interface PipelineRun {
  run_id: string;
  brand_code: string;
  store_code: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  month: string | null;
  note: string | null;
  steps?: PipelineStepRun[];
}

export interface PipelineStepRun {
  step_id: number;
  run_id: string;
  step_name: string;
  step_order: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_in: number | null;
  rows_out: number | null;
  rows_rejected: number;
  duration_sec: number | null;
  error_message: string | null;
}

// Coverage types
export interface CoverageMonthly {
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

// Coverage by file types (T8.5)
export interface CoverageByFile {
  source_file_id: number;
  file_name: string;
  file_path: string;
  store_code: string;
  file_month: string;
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
  uploaded_at: string;
  import_status: string;
}

export interface UnclassifiedByFile {
  source_file_id: number;
  file_name: string;
  month: string;
  counterparty_name: string | null;
  summary: string | null;
  memo: string | null;
  combined_text: string;
  txn_rows: number;
  in_amt: number;
  out_amt: number;
  total_amt: number;
}

// Rule types
export interface BankRule {
  rule_id: number;
  priority: number;
  direction: string;
  match_field: string;
  match_value: string;
  lvl1: string;
  lvl2: string | null;
  enabled: boolean;
  created_at: string;
}

// Unclassified transaction types
export interface UnclassifiedTxn {
  month: string;
  bank_txn_id: number;
  txn_time: string;
  counterparty_name: string | null;
  summary: string | null;
  memo: string | null;
  in_amt: number | null;
  out_amt: number | null;
  balance_amt: number | null;
  source_file_id: number | null;
  combined_text: string;
}

// Override types
export interface BankTxnOverride {
  id: number;
  bank_txn_id: number;
  lvl1: string;
  lvl2: string | null;
  note: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}
