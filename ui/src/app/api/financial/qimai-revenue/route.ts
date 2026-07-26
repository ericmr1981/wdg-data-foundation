import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getDashboardQimaiRevenue } from '@/lib/queries/dashboard';

// GET /api/financial/qimai-revenue?brand=gelatomiiix&period=2026-06&span=month&store=xxx
export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || '';
    const period = searchParams.get('period') || 'all';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

    const result = await getDashboardQimaiRevenue(brandParam, period, span, store);

    if (result.note) {
      return NextResponse.json({ success: true, data: null, note: result.note });
    }

    return NextResponse.json({
      success: true,
      data: result.data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: err?.status || 500 },
    );
  }
}
