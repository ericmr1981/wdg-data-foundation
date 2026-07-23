// Gelatomiiix | 蜜可诗 销售月度 KPI 概览 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';

const BRAND = 'gelatomiiix';
const ODS = 'gelatomiiix_ods';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;
    const excludeOther = searchParams.get('exclude_other') === 'true';

    const schema = getDmSchema(BRAND);

    try {
        if (excludeOther) {
            const conds: string[] = ['NOT is_refund', 'payment_methods IS NOT NULL'];
            const p: unknown[] = [];
            if (storeCode) { p.push(storeCode); conds.push(`store_code = $${p.length}`); }
            if (month)     { p.push(month);     conds.push(`date_trunc('month', biz_date)::date = $${p.length}::date`); }
            const { rows } = await pool.query(`
                SELECT store_code, date_trunc('month', biz_date)::date AS month,
                    SUM(gross_amt) AS gross_amt, SUM(revenue_amt) AS revenue_amt,
                    SUM(discount_amt) AS discount_amt, SUM(net_amt) AS net_amt, COUNT(*) AS order_cnt,
                    ROUND(SUM(revenue_amt)/NULLIF(SUM(gross_amt),0),6) AS cash_in_rate,
                    ROUND(SUM(net_amt)/NULLIF(SUM(gross_amt),0),6) AS profit_rate,
                    ROUND(SUM(discount_amt)/NULLIF(SUM(gross_amt),0),6) AS discount_rate,
                    ROUND(SUM(gross_amt)/NULLIF(COUNT(*),0),2) AS avg_order_amt,
                    ROUND(100.0*SUM(revenue_amt)/NULLIF(SUM(gross_amt),0),2) AS cash_in_rate_pct
                FROM ${ODS}.income_detail WHERE ${conds.join(' AND ')}
                GROUP BY store_code, month ORDER BY store_code, month`, p);
            return NextResponse.json({ success: true, data: rows });
        }

        const conds: string[] = [];
        const params: unknown[] = [];
        if (storeCode) { params.push(storeCode); conds.push(`store_code = $${params.length}`); }
        if (month)     { params.push(month);     conds.push(`month = $${params.length}`); }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool.query(
            `SELECT * FROM ${schema}.v_sales_overview ${where} ORDER BY store_code, month`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01')
            return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
