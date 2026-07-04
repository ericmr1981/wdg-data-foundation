import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildTaobaoReconQuery, buildTaobaoDailyQuery, TAOBAO_RECON_SUPPORTED_BRANDS } from '@/lib/taobao-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/taobao-recon?brand=tamkoko&period=2026-04&span=month&store=hz_fuyang
// GET /api/income/taobao-recon?brand=tamkoko&period=2026-04&span=month&store=wz_bjwxc&t_offset=3
//
// For 世纪汇店 (wz_bjwxc), pass t_offset to use T+N daily aggregation mode.
// Default (no t_offset): LAG-based window matching (compatible with 富阳店 网商银行打款).
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
    const incomeOds = odsSchema;  // tamkoko income_detail lives in brand_tamkoko_ods

    let periodEnd: string | null = null;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    let result;
    let tOffset: number | undefined;
    if (useDaily) {
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
        mode: useDaily ? 'daily' : 'lag',
        t_offset: tOffset,
        rows: result.rows,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}