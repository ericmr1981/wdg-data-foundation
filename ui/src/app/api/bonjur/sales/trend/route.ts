// Bonjur | 旺鼎阁 销售趋势 API
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (storeCode) { params.push(storeCode); conditions.push(`store_code = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const schema = getDmSchema('bonjur');
    try {
        const { rows } = await pool.query(`SELECT * FROM ${schema}.v_sales_trend ${where} ORDER BY store_code, month`, params);
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        if ((error as { code?: string })?.code === '42P01') return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
