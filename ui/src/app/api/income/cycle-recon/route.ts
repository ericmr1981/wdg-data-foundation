import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildCycleReconQuery, CYCLE_RECON_SUPPORTED_BRANDS } from '@/lib/cycle-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/cycle-recon?brand=tamkoko&period=2026-04&span=month&store=hz_fuyang&t_offset=3
// Returns per-bank-entry reconciliation for Tamkoko 苏州泰柯 parent-company
// settlement cycles (WeChat + Alipay). Uses LAG-based window.
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
    if (!CYCLE_RECON_SUPPORTED_BRANDS.includes(brand as 'tamkoko')) {
      return NextResponse.json({
        success: false,
        error: 'cycle reconciliation not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    const incomeOds = odsSchema;

    let periodEnd: string | null = null;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    const [sql, params] = buildCycleReconQuery({
      odsSchema, dmSchema, incomeOds, store, periodEnd, tOffset,
    });
    const result = await pool.query(sql, params);

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