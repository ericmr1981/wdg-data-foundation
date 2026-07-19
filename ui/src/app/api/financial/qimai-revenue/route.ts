import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getDmSchemaSafe, getOdsSchema } from '@/lib/brand-server';
import { parsePeriod } from '../period-utils';
import { getQimaiRevenue } from '@/lib/repositories/financial-repository';

// GET /api/financial/qimai-revenue?brand=gelatomiiix&period=2026-06&span=month&store=xxx
// Returns cumulative bank revenue and qimai revenue up to the selected period
export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || '';
    const period = searchParams.get('period') || 'all';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';
    const brand = normalizeBrand(brandParam);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const isAll = period === 'all';
    const boundaries = isAll ? null : parsePeriod(period, span);
    if (!isAll && !boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });

    const dmSchema = await getDmSchemaSafe(brand);
    const odsSchema = getOdsSchema(brand);
    const incomeOds = brand === 'gelatomiiix' ? 'gelatomiiix_ods' : odsSchema;

    const data = await getQimaiRevenue(dmSchema, odsSchema, incomeOds, period, span, store);

    return NextResponse.json({
      success: true,
      data: {
        bank_revenue: data.bank_revenue,
        qimai_revenue: data.qimai_revenue,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: err?.status || 500 });
  }
}