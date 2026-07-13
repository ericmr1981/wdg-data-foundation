import { NextRequest, NextResponse } from 'next/server';
import { getSalesTrend } from '@/lib/repositories/sales-repository';
import { getErrorMessage } from '@/lib/query-types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const storeCode = searchParams.get('store_code');

    if (!storeCode) {
      return NextResponse.json({ success: false, error: 'store_code required' }, { status: 400 });
    }

    const data = await getSalesTrend('bonjur', storeCode);
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}
