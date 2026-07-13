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
  qimai_net: string | null;
  qimai_gross: string | null;
}

export interface KpiTrendRow extends QueryResultRow {
  month: string;
  revenue_amt: string;
  rev_other_amt: string;
  material_cost_amt: string;
  net_profit_amt: string;
  expense_amt: string;
  non_cogs_exp_amt: string;
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


