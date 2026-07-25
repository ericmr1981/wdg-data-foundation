// Gelatomiiix | 蜜可诗 小时维分析 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';

const ODS = 'gelatomiiix_ods';
const BRAND = 'gelatomiiix';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;
    const excludeOther = searchParams.get('exclude_other') === 'true';
    const schema = getDmSchema(BRAND);

    try {
        if (excludeOther) {
            const conds: string[] = [];
            const p: unknown[] = [];
            if (storeCode) { p.push(storeCode); conds.push(`p.store_code = $${p.length}`); }
            if (month) { p.push(month); conds.push(`date_trunc('month', p.biz_date)::date = $${p.length}::date`); }
            const joinCond = conds.length ? `AND ${conds.join(' AND ')}` : '';
            const { rows } = await pool.query(`
                SELECT p.order_hour,
                    COUNT(DISTINCT p.order_no) AS order_cnt,
                    SUM(p.qty) AS total_qty,
                    SUM(p.sales_amt) AS total_sales,
                    SUM(p.received_amt) AS total_received,
                    SUM(p.discount_amt) AS total_disc,
                    ROUND(100.0 * SUM(p.discount_amt) / NULLIF(SUM(p.sales_amt), 0), 2) AS disc_rate_pct
                FROM ${ODS}.product_sales_detail p
                JOIN ${ODS}.income_detail i ON p.order_no = i.order_no_clean AND NOT i.is_refund AND i.payment_methods IS NOT NULL
                WHERE p.order_hour IS NOT NULL AND p.order_hour != '' AND p.order_hour != '-'
                ${joinCond}
                GROUP BY p.order_hour ORDER BY p.order_hour`, p);
            return NextResponse.json({ success: true, data: rows });
        }

        const conds: string[] = [];
        const params: unknown[] = [];
        if (storeCode) { params.push(storeCode); conds.push(`store_code = $${params.length}`); }
        if (month)     { params.push(month);     conds.push(`month = $${params.length}::date`); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool.query(
            `SELECT order_hour, SUM(order_cnt) AS order_cnt, SUM(total_qty) AS total_qty,
                SUM(total_sales) AS total_sales, SUM(total_received) AS total_received
             FROM ${schema}.v_sales_hourly ${where}
             GROUP BY order_hour ORDER BY order_hour`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01') return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
