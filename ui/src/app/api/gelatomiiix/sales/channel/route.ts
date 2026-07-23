// Gelatomiiix | 蜜可诗 销售支付渠道分布 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';

const BRAND = 'gelatomiiix';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;
    const excludeOther = searchParams.get('exclude_other') === 'true';
    const schema = getDmSchema(BRAND);

    const conds: string[] = [];
    const params: unknown[] = [];
    if (storeCode) { params.push(storeCode); conds.push(`store_code = $${params.length}`); }
    if (month)     { params.push(month);     conds.push(`month = $${params.length}`); }
    if (excludeOther) { conds.push(`channel != '其他'`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM ${schema}.v_sales_channel ${where} ORDER BY gross_amt DESC`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01')
            return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
