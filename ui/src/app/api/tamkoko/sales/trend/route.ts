// Tamkoko 收银明细 12 月趋势 API
// 查询 v_cash_register_overview 取最近 12 个月数据
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';
import { getDmSchema } from '@/lib/brand-server';

const BRAND = 'tamkoko';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const months = Math.min(parseInt(searchParams.get('months') ?? '12', 10) || 12, 24);

    // 用 date_trunc + LAG 算环比
    const params: unknown[] = [];
    let where = '';
    if (storeCode) { params.push(storeCode); where = `WHERE store_code = $${params.length}`; }

    try {
        const { rows } = await pool.query(
            `WITH recent AS (
                SELECT * FROM ${getDmSchema(BRAND)}.v_cash_register_overview
                ${where}
                ORDER BY month DESC
                LIMIT ${months}
            )
            SELECT * FROM recent ORDER BY month ASC`,
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
