export interface InventorySummaryRow {
  store_code: string;
  store_name?: string | null;
  period: string;                  // 'YYYY-MM'
  total_amount: number;
  note: string | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
  // joined from v_inventory_turnover (nullable when no COGS yet)
  cogs_amt: number | null;
  opening_amt: number | null;
  closing_amt: number | null;
  turnover_times: number | null;
  turnover_days: number | null;
}

export interface UpsertInventorySummaryRequest {
  store_code: string;
  period: string;
  total_amount: number;
  note?: string | null;
}