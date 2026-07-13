import pool from '@/lib/db';
import { getOdsSchema } from '@/lib/brand-server';
import type {
  OverviewRow, TrendRow, ChannelRow, DetailRow,
  ProductRow, HourlyRow, DistributionRow, SalesQueryOpts,
} from './sales-types';

export async function getSalesOverview(
  brand: string, storeCode: string, month: string, opts?: SalesQueryOpts
): Promise<OverviewRow> {
  const schema = getOdsSchema(brand);
  const result = await pool.query<OverviewRow>(`
    SELECT
      COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
      COALESCE(SUM(COALESCE(revenue_amt,0)),0) AS revenue_amt,
      COALESCE(SUM(COALESCE(net_amt,0)),0) AS net_amt,
      COUNT(DISTINCT order_no) AS order_cnt,
      CASE WHEN COUNT(DISTINCT order_no) > 0
        THEN ROUND(SUM(COALESCE(gross_amt,0)) / COUNT(DISTINCT order_no), 2)
        ELSE NULL
      END AS avg_order_amt
    FROM ${schema}.income_detail
    WHERE store_code = $1
      AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
  `, [storeCode, `${month}-01`]);
  return result.rows[0];
}

export async function getSalesTrend(
  brand: string, storeCode: string, opts?: SalesQueryOpts
): Promise<TrendRow[]> {
  const schema = getOdsSchema(brand);
  const result = await pool.query<TrendRow>(`
    SELECT
      DATE_TRUNC('month', biz_date)::DATE AS month,
      COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_sales_amt,
      COALESCE(SUM(COALESCE(revenue_amt,0)),0) AS revenue_amt,
      COALESCE(SUM(COALESCE(net_amt,0)),0) AS net_amt,
      COUNT(DISTINCT order_no) AS order_cnt,
      CASE WHEN COUNT(DISTINCT order_no) > 0
        THEN ROUND(SUM(COALESCE(gross_amt,0)) / COUNT(DISTINCT order_no), 2)
        ELSE NULL
      END AS avg_order_amt
    FROM ${schema}.income_detail
    WHERE store_code = $1
      AND biz_date >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '12 months')
    GROUP BY DATE_TRUNC('month', biz_date)::DATE
    ORDER BY month
  `, [storeCode]);
  return result.rows;
}

export async function getSalesByChannel(
  brand: string, storeCode: string, month: string, opts?: SalesQueryOpts
): Promise<ChannelRow[]> {
  const schema = getOdsSchema(brand);
  const pure = opts?.pureMode
    ? `AND NOT ('自定义结账方式' = ANY(payment_methods))`
    : '';
  const result = await pool.query<ChannelRow>(`
    SELECT
      unnest(payment_methods) AS payment_method,
      COALESCE(SUM(COALESCE(gross_amt,0)),0) AS gross_amt,
      COALESCE(SUM(COALESCE(revenue_amt,0)),0) AS revenue_amt,
      COALESCE(SUM(COALESCE(net_amt,0)),0) AS net_amt,
      COUNT(DISTINCT order_no) AS order_cnt
    FROM ${schema}.income_detail,
      unnest(payment_methods) AS pm
    WHERE store_code = $1
      AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      ${pure}
    GROUP BY pm
    ORDER BY gross_amt DESC
  `, [storeCode, `${month}-01`]);
  return result.rows;
}

export async function getSalesDetails(
  brand: string, storeCode: string, month: string, pageNum: number, pageSize: number, opts?: SalesQueryOpts
): Promise<{ rows: DetailRow[]; total: number }> {
  const schema = getOdsSchema(brand);
  const offset = (pageNum - 1) * pageSize;

  const countResult = await pool.query<{ total: string }>(`
    SELECT COUNT(*) AS total
    FROM ${schema}.product_sales_detail
    WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
  `, [storeCode, `${month}-01`]);

  const detailResult = await pool.query<DetailRow>(`
    SELECT biz_date, order_no, product_name, unit_price, qty, sales_amt, received_amt, discount_amt
    FROM ${schema}.product_sales_detail
    WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
    ORDER BY biz_date, order_no
    LIMIT $3 OFFSET $4
  `, [storeCode, `${month}-01`, pageSize, offset]);

  return {
    rows: detailResult.rows,
    total: Number(countResult.rows[0]?.total ?? 0),
  };
}

export async function getSalesByProduct(
  brand: string, storeCode: string, month: string, opts?: SalesQueryOpts
): Promise<ProductRow[]> {
  const schema = getOdsSchema(brand);
  let pureSql = '';
  if (opts?.pureMode) {
    pureSql = `AND order_no NOT IN (
      SELECT order_no_clean FROM ${schema}.income_detail
      WHERE (payment_methods IS NULL OR '自定义结账方式' = ANY(payment_methods))
        AND store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND order_no_clean IS NOT NULL
    )`;
  }

  const result = await pool.query<ProductRow>(`
    SELECT product_name,
      SUM(COALESCE(qty,0)) AS qty,
      SUM(COALESCE(received_amt,0)) AS total_received_amt
    FROM ${schema}.product_sales_detail
    WHERE store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      ${pureSql}
    GROUP BY product_name
    ORDER BY total_received_amt DESC
    LIMIT 10
  `, [storeCode, `${month}-01`]);

  return result.rows;
}

export async function getSalesByHour(
  brand: string, storeCode: string, month: string, opts?: SalesQueryOpts
): Promise<HourlyRow[]> {
  const schema = getOdsSchema(brand);
  const pure = opts?.pureMode
    ? `AND order_no NOT IN (
      SELECT order_no_clean FROM ${schema}.income_detail
      WHERE (payment_methods IS NULL OR '自定义结账方式' = ANY(payment_methods))
        AND store_code = $1 AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND order_no_clean IS NOT NULL
    )`
    : '';

  const result = await pool.query<HourlyRow>(`
    SELECT order_hour, COUNT(DISTINCT order_no) AS order_cnt
    FROM ${schema}.product_sales_detail
    WHERE store_code = $1
      AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
      AND order_hour IS NOT NULL
      ${pure}
    GROUP BY order_hour
    ORDER BY order_hour
  `, [storeCode, `${month}-01`]);
  return result.rows;
}

export async function getSalesDistribution(
  brand: string, storeCode: string, month: string, opts?: SalesQueryOpts
): Promise<DistributionRow[]> {
  const schema = getOdsSchema(brand);
  const pure = opts?.pureMode
    ? `AND payment_methods IS NOT NULL AND NOT ('自定义结账方式' = ANY(payment_methods))`
    : '';
  const result = await pool.query<DistributionRow>(`
    WITH bins AS (
      SELECT
        floor(COALESCE(gross_amt, 0) / 20) * 20 AS bin_start,
        COUNT(*) AS order_cnt
      FROM ${schema}.income_detail
      WHERE store_code = $1
        AND DATE_TRUNC('month', biz_date)::DATE = $2::DATE
        AND NOT is_refund
        ${pure}
      GROUP BY floor(COALESCE(gross_amt, 0) / 20) * 20
    )
    SELECT bin_start, order_cnt
    FROM bins
    ORDER BY bin_start
  `, [storeCode, `${month}-01`]);
  return result.rows;
}
