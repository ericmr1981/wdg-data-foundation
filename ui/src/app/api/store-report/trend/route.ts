import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import type { ApiResult, TrendResponse, KpiMetricKey } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json<ApiResult<TrendResponse>>({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const monthsParam = searchParams.get('months') ?? '12';

    if (!brandRaw || !store) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, data: null, error: 'Missing params: brand, store' },
        { status: 400 }
      );
    }

    const months = Math.min(Math.max(parseInt(monthsParam, 10) || 12, 1), 24);

    const brand = normalizeBrand(brandRaw);
    if (!brand) {
      return NextResponse.json<ApiResult<TrendResponse>>(
        { success: false, data: null, error: `Invalid brand: ${brandRaw}` },
        { status: 400 }
      );
    }
    const schema = await getDmSchemaSafe(brand);

    let rows: any[];
    try {
      const r = await pool.query(
        `SELECT month,
                revenue_amt, expense_amt, gross_profit_amt, net_profit_amt,
                operating_cf_amt, cash_balance, cashflow_runway_months,
                hr_ratio_pct, rent_ratio_pct
         FROM ${schema}.v_store_monthly_kpi
         WHERE store_code = $1
         ORDER BY month DESC
         LIMIT $2`,
        [store, months]
      );
      rows = r.rows.reverse();
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json<ApiResult<TrendResponse>>(
          { success: true, data: null, note: 'view not ready' }
        );
      }
      throw e;
    }

    const seriesKeys: KpiMetricKey[] = [
      'revenue_amt', 'expense_amt', 'gross_profit_amt', 'net_profit_amt',
      'operating_cf_amt', 'cash_balance', 'cashflow_runway_months',
      'hr_ratio_pct', 'rent_ratio_pct',
    ];
    const series = {} as Record<KpiMetricKey, (number | null)[]>;
    for (const k of seriesKeys) series[k] = [];
    const monthList: string[] = [];

    for (const r of rows) {
      const m = r.month instanceof Date
        ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
        : String(r.month);
      monthList.push(m);
      for (const k of seriesKeys) {
        const v = r[k as string];
        series[k].push(v == null ? null : Number(v));
      }
    }

    return NextResponse.json<ApiResult<TrendResponse>>({
      success: true,
      data: { months: monthList, series },
    });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<TrendResponse>>(
      { success: false, data: null, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
