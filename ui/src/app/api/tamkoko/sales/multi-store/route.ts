// Tamkoko 收银明细 多门店对比 API
// 委托到 brand_tamkoko_dm.v_cash_register_multi_store (month 必填)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const monthRaw = searchParams.get('month') ?? null;

    if (!monthRaw) {
        return NextResponse.json({ success: false, error: 'month is required (YYYY-MM or YYYY-MM-01)' }, { status: 400 });
    }

    const month = monthRaw.length === 7 ? monthRaw + '-01' : monthRaw;

    try {
        const { rows } = await pool.query(
            `SELECT * FROM brand_tamkoko_dm.v_cash_register_multi_store WHERE month = $1 ORDER BY store_code`,
            [month]
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