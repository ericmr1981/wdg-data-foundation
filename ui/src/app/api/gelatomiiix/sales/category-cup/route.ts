// Gelatomiiix | 蜜可诗 品类健康度 + 杯型折扣分析 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

const ODS = 'gelatomiiix_ods';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;

    try {
        const p: unknown[] = [];
        const conds: string[] = [];
        if (storeCode) { p.push(storeCode); conds.push(`p.store_code = $${p.length}`); }
        if (month)     { p.push(month);     conds.push(`date_trunc('month', p.biz_date)::date = $${p.length}::date`); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

        // 1. Category health: sales share vs discount rate
        const catQuery = `
            WITH totals AS (
                SELECT SUM(p.qty) AS all_qty, SUM(p.sales_amt) AS all_sales
                FROM ${ODS}.product_sales_detail p
                ${where}
            )
            SELECT
                COALESCE(NULLIF(p.category, ''), '未分类') AS category,
                COUNT(DISTINCT p.product_name) AS sku_cnt,
                SUM(p.qty) AS total_qty,
                ROUND(SUM(p.sales_amt)::numeric, 0) AS total_sales,
                ROUND(SUM(p.received_amt)::numeric, 0) AS total_received,
                ROUND(SUM(p.discount_amt)::numeric, 0) AS total_disc,
                ROUND(100.0 * SUM(p.qty) / NULLIF(MAX(t.all_qty), 0), 1) AS qty_share_pct,
                ROUND(100.0 * SUM(p.sales_amt) / NULLIF(MAX(t.all_sales), 0), 1) AS sales_share_pct,
                ROUND(100.0 * SUM(p.discount_amt) / NULLIF(SUM(p.sales_amt), 0), 2) AS disc_rate_pct,
                ROUND(100.0 * SUM(p.received_amt) / NULLIF(SUM(p.sales_amt), 0), 2) AS cash_in_rate_pct,
                ROUND(AVG(p.unit_price)::numeric, 1) AS avg_price
            FROM ${ODS}.product_sales_detail p, totals t
            ${where}
            GROUP BY category ORDER BY total_sales DESC`;

        // 2. Cup type × discount
        const cupQuery = `
            SELECT
                CASE
                    WHEN p.spec IS NULL OR p.spec = '' OR p.spec = '-' THEN '标准'
                    WHEN p.spec LIKE '%,%' THEN TRIM(LEADING '\\u0060' FROM SUBSTRING(p.spec FROM 1 FOR POSITION(',' IN p.spec) - 1))
                    ELSE TRIM(LEADING '\\u0060' FROM p.spec)
                END AS cup_type,
                COUNT(*) AS lines,
                SUM(p.qty) AS total_qty,
                ROUND(SUM(p.sales_amt)::numeric, 0) AS total_sales,
                ROUND(SUM(p.discount_amt)::numeric, 0) AS total_disc,
                ROUND(100.0 * SUM(p.discount_amt) / NULLIF(SUM(p.sales_amt), 0), 2) AS disc_rate_pct,
                COUNT(*) FILTER (WHERE p.discount_amt > 0) AS disc_lines,
                ROUND(AVG(p.unit_price)::numeric, 1) AS avg_price
            FROM ${ODS}.product_sales_detail p
            ${where}
            GROUP BY cup_type ORDER BY total_sales DESC`;

        const [catR, cupR] = await Promise.all([
            pool.query(catQuery, p),
            pool.query(cupQuery, p),
        ]);

        return NextResponse.json({
            success: true,
            data: {
                categories: catR.rows,
                cups: cupR.rows,
            },
        });
    } catch (error) {
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
