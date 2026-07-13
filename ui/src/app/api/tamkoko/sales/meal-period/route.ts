// Tamkoko 收银明细 时段维度 API
// 委托到 ${getDmSchema(BRAND)}.v_cash_register_meal_period_overview / _detail
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
    const detail = searchParams.get('detail') === 'true';
    const date = searchParams.get('date') ?? null;

    const view = detail
        ? 'v_cash_register_meal_period_detail'
        : 'v_cash_register_meal_period_overview';

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (storeCode) {
        params.push(storeCode);
        conditions.push(`store_code = $${params.length}`);
    }
    if (detail) {
        // detail view: filter by biz_date
        if (date) {
            params.push(date);
            conditions.push(`biz_date = $${params.length}`);
        }
    } else {
        // overview view: filter by month
        if (month) {
            params.push(month);
            conditions.push(`month = $${params.length}`);
        }
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
        const { rows } = await pool.query(
            `SELECT * FROM ${getDmSchema(BRAND)}.${view} ${where} ORDER BY store_code${detail ? ', biz_date, meal_period' : ', month, meal_period'}`,
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