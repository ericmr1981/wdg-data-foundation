// Tamkoko 收银明细 渠道维度 API
// 委托到 ${getDmSchema(BRAND)}.v_cash_register_channel
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';

const BRAND = 'tamkoko';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const monthRaw = searchParams.get('month') ?? null;
    const month = monthRaw && monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;
    const source = searchParams.get('source') ?? null;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (storeCode) { params.push(storeCode); conditions.push(`store_code = $${params.length}`); }
    if (month)     { params.push(month);     conditions.push(`month = $${params.length}`); }
    if (source)    { params.push(source);    conditions.push(`order_source = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM ${getDmSchema(BRAND)}.v_cash_register_channel ${where} ORDER BY store_code, month, order_source`,
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