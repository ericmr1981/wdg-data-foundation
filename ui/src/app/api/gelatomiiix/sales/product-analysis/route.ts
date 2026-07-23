// Gelatomiiix | 蜜可诗 产品规格销售分析 API
// 支持 group_by=spec (按规格聚合) 或不传 (按单品)
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
    const groupBy = searchParams.get('group_by') ?? '';
    const excludeOther = searchParams.get('exclude_other') === 'true';
    const schema = getDmSchema(BRAND);

    try {
        if (excludeOther) {
            const conds: string[] = [];
            const p: unknown[] = [];
            if (storeCode) { p.push(storeCode); conds.push(`p.store_code = $${p.length}`); }
            if (month) { p.push(month); conds.push(`date_trunc('month', p.biz_date)::date = $${p.length}::date`); }
            const joinCond = conds.length ? `AND ${conds.join(' AND ')}` : '';

            if (groupBy === 'spec') {
                const { rows } = await pool.query(`
                    SELECT date_trunc('month', p.biz_date)::date AS month,
                        CASE 
                            WHEN p.spec IS NULL OR p.spec = '' OR p.spec = '-' THEN '标准'
                            WHEN p.spec LIKE '%,%' THEN TRIM(LEADING '\\u0060' FROM SUBSTRING(p.spec FROM 1 FOR POSITION(',' IN p.spec) - 1))
                            ELSE TRIM(LEADING '\\u0060' FROM p.spec)
                        END AS spec_level1,
                        CASE 
                            WHEN p.spec IS NULL OR p.spec = '' OR p.spec = '-' THEN '标准'
                            WHEN p.spec LIKE '%,%' THEN TRIM(SUBSTRING(p.spec FROM POSITION(',' IN p.spec) + 1))
                            ELSE '标准'
                        END AS spec_level2_raw,
                        p.qty, p.sales_amt, p.received_amt, p.discount_amt
                    FROM ${ODS}.product_sales_detail p
                    JOIN ${ODS}.income_detail i ON p.order_no = i.order_no AND NOT i.is_refund AND i.payment_methods IS NOT NULL
                    ${joinCond}
                `, p);
                // 在 SQL 内完成解析和聚合太复杂，用 Python 在内存处理
                const specMap: Record<string, { qty: number; sales: number; received: number; disc: number; cnt: number }> = {};
                for (const r of rows) {
                    const spec1 = r.spec_level1;
                    let spec2 = r.spec_level2_raw;
                    const idx = Math.max(spec2.indexOf('（'), spec2.indexOf('('));
                    if (idx > 0) spec2 = spec2.substring(0, idx).trim();
                    const key = `${spec1}|${spec2}`;
                    if (!specMap[key]) specMap[key] = { qty: 0, sales: 0, received: 0, disc: 0, cnt: 0 };
                    specMap[key].qty += Number(r.qty) || 0;
                    specMap[key].sales += Number(r.sales_amt) || 0;
                    specMap[key].received += Number(r.received_amt) || 0;
                    specMap[key].disc += Number(r.discount_amt) || 0;
                    specMap[key].cnt += 1;
                }
                const result = Object.entries(specMap)
                    .map(([key, v]) => {
                        const [s1, s2] = key.split('|');
                        return {
                            spec_level1: s1, spec_level2: s2,
                            total_qty: String(v.qty), total_sales: String(v.sales),
                            total_received: String(v.received), total_discount: String(v.disc),
                            cash_in_rate_pct: v.sales > 0 ? String(+(v.received / v.sales * 100).toFixed(2)) : '0',
                            product_count: String(v.cnt),
                        };
                    })
                    .sort((a, b) => Number(b.total_sales) - Number(a.total_sales));
                return NextResponse.json({ success: true, data: result });
            } else {
                const { rows } = await pool.query(`
                    SELECT p.store_code, p.biz_date, p.product_name, p.unit_price,
                        SUM(p.qty) AS total_qty, SUM(p.sales_amt) AS total_sales,
                        SUM(p.received_amt) AS total_received, SUM(p.discount_amt) AS total_discount,
                        ROUND(100.0*SUM(p.received_amt)/NULLIF(SUM(p.sales_amt),0),2) AS cash_in_rate_pct
                    FROM ${ODS}.product_sales_detail p
                    JOIN ${ODS}.income_detail i ON p.order_no = i.order_no AND NOT i.is_refund AND i.payment_methods IS NOT NULL
                    ${joinCond}
                    GROUP BY p.store_code, p.biz_date, p.product_name, p.unit_price
                    ORDER BY total_sales DESC`, p);
                return NextResponse.json({ success: true, data: rows });
            }
        }

        const conds: string[] = [];
        const params: unknown[] = [];
        if (storeCode)    { params.push(storeCode); conds.push(`store_code = $${params.length}`); }
        if (month) {
            const col = groupBy === 'spec' ? 'month' : `date_trunc('month', biz_date)::date`;
            conds.push(`${col} = $${params.length + 1}::date`);
            params.push(month);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const view = groupBy === 'spec' ? `${schema}.v_sales_spec_overview` : `${schema}.v_sales_product_analysis`;
        const { rows } = await pool.query(`SELECT * FROM ${view} ${where} ORDER BY total_sales DESC`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01')
            return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
