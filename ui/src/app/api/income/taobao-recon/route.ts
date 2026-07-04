import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildTaobaoReconQuery, buildTaobaoDailyQuery, buildTaobaoHybridQuery, TAOBAO_RECON_SUPPORTED_BRANDS } from '@/lib/taobao-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/taobao-recon?brand=tamkoko&period=2026-06&span=month&store=hz_fuyang
// GET /api/income/taobao-recon?brand=tamkoko&period=2026-06&span=month&store=sh_sjh&t_offset=3
//
// Three modes:
//   - LAG (default): sliding window matching for weekly-batch settlements (富阳 old, 滨江)
//   - DAILY (t_offset=3): T+N daily aggregation (世纪汇 sh_sjh)
//   - HYBRID (store=hz_fuyang & t_offset=3): LAG for < cutoff, T+N for >= cutoff
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';
    const tOffsetRaw = parseInt(sp.get('t_offset') || '', 10);
    const useDaily = Number.isFinite(tOffsetRaw);

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'invalid_brand' }, { status: 400 });
    }
    if (!TAOBAO_RECON_SUPPORTED_BRANDS.includes(brand as 'tamkoko')) {
      return NextResponse.json({
        success: false,
        error: 'taobao reconciliation not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    const incomeOds = odsSchema;  // tamkogo income_detail lives in brand_tamkoko_ods

    let periodEnd: string | null = null;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    // Hybrid mode: hz_fuyang with t_offset provided — LAG before 6/16, T+N from 6/16
    const isHybrid = store === 'hz_fuyang' && useDaily;

    let result;
    let tOffset: number | undefined;
    if (isHybrid) {
      tOffset = Number.isFinite(tOffsetRaw) ? Math.max(0, tOffsetRaw) : 3;
      const [sql, params] = buildTaobaoHybridQuery({
        odsSchema, dmSchema, incomeOds, store, periodEnd,
        tOffset, cutoffDate: '2026-06-16',
      });
      result = await pool.query(sql, params);
    } else if (useDaily) {
      tOffset = Number.isFinite(tOffsetRaw) ? Math.max(0, tOffsetRaw) : 3;
      const [sql, params] = buildTaobaoDailyQuery({
        odsSchema, dmSchema, incomeOds, store, periodEnd, tOffset,
      });
      result = await pool.query(sql, params);
    } else {
      const [sql, params] = buildTaobaoReconQuery({
        odsSchema, dmSchema, incomeOds, store, periodEnd,
      });
      result = await pool.query(sql, params);
    }

    return NextResponse.json({
      success: true,
      data: {
        brand,
        period,
        span,
        store: store || 'all',
        mode: isHybrid ? 'hybrid' : useDaily ? 'daily' : 'lag',
        t_offset: tOffset,
        rows: result.rows,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}