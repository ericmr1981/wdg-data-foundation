// Tamkoko 收银明细 周维度 API
// 委托到 brand_tamkoko_dm.v_cash_register_weekday
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const from = searchParams.get('from') ?? null;
    const to = searchParams.get('to') ?? null;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (storeCode) { params.push(storeCode); conditions.push(`store_code = $${params.length}`); }
    if (from)      { params.push(from);      conditions.push(`week_start >= $${params.length}`); }
    if (to)        { params.push(to);        conditions.push(`week_start <= $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM brand_tamkoko_dm.v_cash_register_weekday ${where} ORDER BY store_code, week_start`,
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