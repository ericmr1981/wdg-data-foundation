import type { QueryResultRow } from 'pg';

export interface ProfitRow extends QueryResultRow {
  lvl1_code: string;
  amount: string;
}

export interface CashflowRow extends QueryResultRow {
  activity: string;
  net_amount: string;
}

export interface BalanceSheetRow extends QueryResultRow {
  cash_balance: string;
}

export interface OverviewData {
  profit: ProfitRow[];
  cashflow: CashflowRow[];
  balance: BalanceSheetRow | null;
  cogs_total: string;
}

export interface KpiTrendRow extends QueryResultRow {
  month: string;
  revenue_amt: string;
  expense_amt: string;
  gross_profit_amt: string;
  net_profit_amt: string;
  operating_cf_amt: string;
  cash_balance: string;
  cashflow_runway_months: string | null;
  hr_ratio_pct: string | null;
  rent_ratio_pct: string | null;
}

export interface IncomeMetricsRow extends QueryResultRow {
  lvl1_code: string;
  amount: string;
}

export interface PaymentMetricsRow extends QueryResultRow {
  lvl1_code: string;
  lvl2_code: string;
  amount: string;
}

export interface CounterpartyRow extends QueryResultRow {
  counterparty_name: string;
  total_amt: string;
  txn_count: string;
}

export interface QimaiRevenueRow extends QueryResultRow {
  month: string;
  revenue_amt: string;
}
