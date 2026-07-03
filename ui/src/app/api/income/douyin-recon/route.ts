import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildDouyinDailyQuery, DOUYIN_RECON_SUPPORTED_BRANDS } from '@/lib/douyin-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/douyin-recon?brand=tamkoko&period=2026-04&span=month&store=hz_fuyang&t_offset=5
// Returns daily Douyin group-buy (抖音团购券) reconciliation rows (T+5 default).
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';
    const tOffsetRaw = parseInt(sp.get('t_offset') || '5', 10);
    const tOffset = Number.isFinite(tOffsetRaw) ? Math.max(0, tOffsetRaw) : 5;

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'invalid_brand' }, { status: 400 });
    }
    if (!DOUYIN_RECON_SUPPORTED_BRANDS.includes(brand as 'tamkoko')) {
      return NextResponse.json({
        success: false,
        error: 'douyin reconciliation not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    const incomeOds = odsSchema;

    let periodEnd: string | undefined = undefined;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    const sql = buildDouyinDailyQuery({
      odsSchema, dmSchema, incomeOds, periodEnd: periodEnd!, tOffset,
    });
    const result = await pool.query(sql);

    return NextResponse.json({
      success: true,
      data: {
        brand,
        period,
        span,
        store: store || 'all',
        t_offset: tOffset,
        rows: result.rows,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}