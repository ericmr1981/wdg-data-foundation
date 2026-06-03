import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import type { ApiResult, SnapshotResponse, StoreKpi } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json<ApiResult<SnapshotResponse>>({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month'); // YYYY-MM

    if (!brandRaw || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, data: null, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    if (!brand) {
      return NextResponse.json<ApiResult<SnapshotResponse>>(
        { success: false, data: null, error: `Invalid brand: ${brandRaw}` },
        { status: 400 }
      );
    }
    const schema = await getDmSchemaSafe(brand);

    const prevMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${String(pm).padStart(2, '0')}`;
    })();

    let currentRows: StoreKpi[];
    let previousRows: StoreKpi[] = [];
    try {
      const cur = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE to_char(month, 'YYYY-MM') = $1 AND store_code = $2`,
        [month, store]
      );
      currentRows = cur.rows;
      if (currentRows.length === 0) {
        return NextResponse.json<ApiResult<SnapshotResponse>>(
          { success: false, data: null, error: `No data for ${store}@${month}` },
          { status: 404 }
        );
      }
      const prev = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE to_char(month, 'YYYY-MM') = $1 AND store_code = $2`,
        [prevMonth, store]
      );
      previousRows = prev.rows;
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json<ApiResult<SnapshotResponse>>(
          { success: true, data: null, note: 'view not ready' }
        );
      }
      throw e;
    }

    const toKpi = (r: any): StoreKpi => ({
      month: r.month instanceof Date ? r.month.toISOString().slice(0, 7) : String(r.month),
      revenue_amt: Number(r.revenue_amt),
      cost_amt: Number(r.cost_amt),
      expense_amt: Number(r.expense_amt),
      hr_amt: Number(r.hr_amt),
      rent_amt: Number(r.rent_amt),
      gross_profit_amt: Number(r.gross_profit_amt),
      net_profit_amt: Number(r.net_profit_amt),
      operating_cf_amt: Number(r.operating_cf_amt),
      total_in_amt: Number(r.total_in_amt),
      total_out_amt: Number(r.total_out_amt),
      cash_balance: Number(r.cash_balance),
      loan_balance: Number(r.loan_balance),
      cashflow_runway_months: r.cashflow_runway_months == null ? null : Number(r.cashflow_runway_months),
      hr_ratio_pct: r.hr_ratio_pct == null ? null : Number(r.hr_ratio_pct),
      rent_ratio_pct: r.rent_ratio_pct == null ? null : Number(r.rent_ratio_pct),
    });

    return NextResponse.json<ApiResult<SnapshotResponse>>({
      success: true,
      data: {
        current: toKpi(currentRows[0]),
        previous: previousRows[0] ? toKpi(previousRows[0]) : null,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json<ApiResult<SnapshotResponse>>(
      { success: false, data: null, error: getErrorMessage(err) },
      { status: 500 }
    );
  }
}
