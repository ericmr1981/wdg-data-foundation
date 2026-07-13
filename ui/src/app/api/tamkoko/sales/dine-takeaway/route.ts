// Tamkoko 收银明细 堂食/外卖维度 API
// 委托到 brand_tamkoko_dm.v_cash_register_dine_takeaway
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;
    const type = searchParams.get('type') ?? null;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (storeCode) { params.push(storeCode); conditions.push(`store_code = $${params.length}`); }
    if (month)     { params.push(month);     conditions.push(`month = $${params.length}`); }
    if (type)      { params.push(type);      conditions.push(`order_type = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM brand_tamkoko_dm.v_cash_register_dine_takeaway ${where} ORDER BY store_code, month, order_type`,
            params
        );
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === '42P01') {
            return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        }
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}