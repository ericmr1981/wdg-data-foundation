// Tamkoko 收银明细 交叉维度 API
// 委托到 brand_tamkoko_dm.fn_cash_register_combined (白名单校验 dim)
import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getErrorMessage, getErrorCode } from '@/lib/query-types';

const ALLOWED_DIMS = ['order_source', 'order_type', 'meal_period', 'weekday'];

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store') ?? null;
    const month = searchParams.get('month') ?? null;
    const dim1 = searchParams.get('dim1') ?? 'order_source';
    const dim2 = searchParams.get('dim2') ?? 'order_type';

    if (!ALLOWED_DIMS.includes(dim1) || !ALLOWED_DIMS.includes(dim2)) {
        return NextResponse.json({ success: false, error: `invalid dim; allowed: ${ALLOWED_DIMS.join(',')}` }, { status: 400 });
    }

    try {
        const { rows } = await pool.query(
            `SELECT * FROM brand_tamkoko_dm.fn_cash_register_combined($1, $2, $3, $4)`,
            [storeCode, month, dim1, dim2]
        );
        return NextResponse.json({ success: true, data: rows });
    } catch (error) {
        const code = getErrorCode(error);
        if (code === '42P01') {
            return NextResponse.json({ success: true, data: null, note: 'function not ready' });
        }
        return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
    }
}