import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getOdsSchema, getDmSchema } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '@/app/api/financial/period-utils';
import { buildTaobaoReconQuery, TAOBAO_RECON_SUPPORTED_BRANDS } from '@/lib/taobao-recon';

export const dynamic = 'force-dynamic';

// GET /api/income/taobao-recon?brand=tamkoko&period=2026-04&span=month&store=hz_fuyang
// Returns per-bank-entry TAOBAO settlement reconciliation rows. Each bank
// entry is matched to Qimai orders in the window
//   [prev_txn_time - 3 days, current_txn_time - 4 days]
// so consecutive entries cover a contiguous Qimai range (no gap, no overlap).
export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const brandParam = sp.get('brand');
    const period = sp.get('period') || 'all';
    const span = sp.get('span') || 'month';
    const store = sp.get('store') || '';

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

    let periodEnd: string | undefined = undefined;
    if (period !== 'all') {
      const range = parsePeriod(period, span);
      if (!range) {
        return NextResponse.json({ success: false, error: 'invalid_period' }, { status: 400 });
      }
      periodEnd = range[1];
    }

    const sql = buildTaobaoReconQuery({
      odsSchema, dmSchema, incomeOds, periodEnd: periodEnd!,
    });
    const result = await pool.query(sql);

    return NextResponse.json({
      success: true,
      data: {
        brand,
        period,
        span,
        store: store || 'all',
        rows: result.rows,
      },
    });
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: 500 });
  }
}