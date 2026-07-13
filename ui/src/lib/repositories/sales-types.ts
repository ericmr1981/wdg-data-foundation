import type { QueryResultRow } from 'pg';

export interface OverviewRow extends QueryResultRow {
  gross_sales_amt: string;
  revenue_amt: string;
  net_amt: string;
  order_cnt: string;
  avg_order_amt: string | null;
}

export interface TrendRow extends QueryResultRow {
  month: string;
  gross_sales_amt: string;
  revenue_amt: string;
  order_cnt: string;
}

export interface ChannelRow extends QueryResultRow {
  payment_method: string;
  txn_cnt: string;
  gross_amt: string;
  revenue_amt: string;
}

export interface DetailRow extends QueryResultRow {
  biz_date: string;
  order_no: string;
  product_name: string;
  unit_price: string;
  qty: string;
  sales_amt: string;
  received_amt: string;
  discount_amt: string;
}

export interface ProductRow extends QueryResultRow {
  product_name: string;
  total_qty: string;
  total_received_amt: string;
}

export interface HourlyRow extends QueryResultRow {
  order_hour: string;
  order_cnt: string;
}

export interface DistributionRow extends QueryResultRow {
  bin_start: string;
  bin_end: string;
  order_cnt: string;
}

export interface SalesQueryOpts {
  pureMode?: boolean;
  page?: number;
  pageSize?: number;
}
