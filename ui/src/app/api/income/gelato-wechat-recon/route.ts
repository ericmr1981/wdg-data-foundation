import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildGelatoWechatQuery, GELATO_RECON_SUPPORTED_BRANDS } from '@/lib/gelato-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/gelato-wechat-recon?brand=gelatomiiix&period=2026-04&span=month&store=sh_xtd&t_offset=1
// Returns per-bank-entry 微信 reconciliation rows. T+1 default.
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';
    const tOffsetRaw = parseInt(sp.get('t_offset') || '1', 10);
    const tOffset = Number.isFinite(tOffsetRaw) ? Math.max(0, tOffsetRaw) : 1;

    if (!brandParam) {
      return NextResponse.json({ success: false, error: 'brand required' }, { status: 400 });
    }
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'invalid_brand' }, { status: 400 });
    }
    if (!GELATO_RECON_SUPPORTED_BRANDS.includes(brand as 'gelatomiiix')) {
      return NextResponse.json({
        success: false,
        error: 'gelato wechat reconciliation not supported for this brand',
      }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);
    const dmSchema = getDmSchema(brand);
    // Gelato's income_detail is in the legacy `gelatomiiix_ods` schema.
    const incomeOds = 'gelatomiiix_ods';

    let periodEnd: string | null = null;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    const [sql, params] = buildGelatoWechatQuery({
      odsSchema, dmSchema, incomeOds, periodEnd, tOffset, store,
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