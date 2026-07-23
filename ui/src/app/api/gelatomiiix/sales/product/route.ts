// Gelatomiiix | 蜜可诗 商品销售排行 API
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
                SELECT p.store_code, date_trunc('month', p.biz_date)::date AS month,
                    p.product_name, SUM(p.qty) AS total_qty, SUM(p.sales_amt) AS total_sales,
                    SUM(p.received_amt) AS total_received, SUM(p.discount_amt) AS total_discount,
                    ROUND(100.0*SUM(p.received_amt)/NULLIF(SUM(p.sales_amt),0),2) AS cash_in_rate_pct
                FROM ${ODS}.product_sales_detail p
                JOIN ${ODS}.income_detail i ON p.order_no = i.order_no AND NOT i.is_refund AND i.payment_methods IS NOT NULL
                ${joinCond}
                GROUP BY p.store_code, month, p.product_name
                ORDER BY total_received DESC LIMIT 10`, p);
            return NextResponse.json({ success: true, data: rows });
        }
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (storeCode) { params.push(storeCode); conditions.push(`store_code = $${params.length}`); }
        if (month)     { params.push(month);     conditions.push(`month = $${params.length}`); }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await pool.query(`SELECT * FROM ${schema}.v_sales_product ${where} ORDER BY total_received DESC LIMIT 10`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01') return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
