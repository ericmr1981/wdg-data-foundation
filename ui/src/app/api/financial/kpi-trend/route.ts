import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { getDashboardTrend } from '@/lib/queries/dashboard';

// GET /api/financial/kpi-trend?brand=x&period=2026-06&span=month&store=xxx
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || '';
    const period = searchParams.get('period') || 'all';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

    if (!['month', 'quarter', 'year'].includes(span)) {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    const result = await getDashboardTrend(brandParam, period, span, store);

    if (result.note) {
      return NextResponse.json({ success: true, data: null, note: result.note });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (error: unknown) {
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in kpi-trend route:', error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status });
  }
}
