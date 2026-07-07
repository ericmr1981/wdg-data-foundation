// Tamkoko 收银明细 月内日级趋势 API(drill-down)
// 查询 v_cash_register_daily 按 biz_date 范围过滤
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage } from '@/lib/query-types';

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const month = searchParams.get('month'); // 'YYYY-MM-01'

    if (!month || !/^\d{4}-\d{2}-\d{2}$/.test(month)) {
        return NextResponse.json({ success: false, error: 'month required (YYYY-MM-01)' }, { status: 400 });
    }

    // 计算月初 + 下月初
    const params: unknown[] = [month];
    let where = `WHERE biz_date >= $1::date AND biz_date < ($1::date + INTERVAL '1 month')`;
    if (storeCode) { params.push(storeCode); where += ` AND store_code = $${params.length}`; }

    try {
        const { rows } = await pool.query(
            `SELECT * FROM brand_tamkoko_dm.v_cash_register_daily ${where} ORDER BY biz_date ASC`,
            params
        );
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        const code = (error as Record<string, string>)?.code;
        if (code === '42P01') {
            return NextResponse.json({ success: true, data: null, note: 'view not ready' });
        }
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}
