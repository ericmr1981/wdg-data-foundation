import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildMeituanDailyQuery, MEITUAN_RECON_SUPPORTED_BRANDS } from '@/lib/meituan-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/meituan-recon?brand=tamkoko&period=2026-04&span=month&store=hz_fuyang&t_offset=1
// Returns daily Meituan settlement reconciliation rows (T+1 match).
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';
    const tOffsetRaw = parseInt(sp.get('t_offset') || '3', 10);
    const tOffset = Number.isFinite(tOffsetRaw) ? Math.max(0, tOffsetRaw) : 3;

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'invalid_brand' }, { status: 400 });
    }
    if (!MEITUAN_RECON_SUPPORTED_BRANDS.includes(brand as 'tamkoko')) {
      return NextResponse.json({
        success: false,
        error: 'meituan reconciliation not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    const incomeOds = odsSchema;  // tamkoko income_detail lives in brand_tamkoko_ods

    let periodEnd: string | undefined = undefined;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    const sql = buildMeituanDailyQuery({
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