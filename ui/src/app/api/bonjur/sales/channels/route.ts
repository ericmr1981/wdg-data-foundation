import { NextRequest, NextResponse } from 'next/server';
import { getSalesByChannel } from '@/lib/repositories/sales-repository';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');
    const month = searchParams.get('month');

    if (!storeCode || !month) {
      return NextResponse.json({ success: false, error: 'store_code and month required' }, { status: 400 });
    }

    const rows = await getSalesByChannel('bonjur', storeCode, month);
    const total = rows.reduce((acc: number, r) => acc + Number(r.gross_amt), 0);
    const data = rows.map((r) => ({
      ...r,
      gross_amt: Number(r.gross_amt),
      revenue_amt: Number(r.revenue_amt),
      txn_cnt: Number(r.txn_cnt),
      pct: total > 0 ? Math.round(Number(r.gross_amt) / total * 10000) / 100 : 0,
    }));

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
