import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import { buildStoreReportWorkbook, workbookToBuffer } from '@/lib/excel-export';
import type { SnapshotResponse, StoreKpi, TrendResponse, KpiMetricKey } from '@/lib/store-report-types';

const PG_ERR_NO_VIEW = '42P01';

export async function GET(request: Request) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, data: null, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const brandRaw = searchParams.get('brand');
    const store = searchParams.get('store');
    const month = searchParams.get('month');

    if (!brandRaw || !store || !month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { success: false, data: null, error: 'Missing or invalid params: brand, store, month (YYYY-MM)' },
        { status: 400 }
      );
    }

    const brand = normalizeBrand(brandRaw);
    if (!brand) {
      return NextResponse.json({ success: false, data: null, error: `Invalid brand: ${brandRaw}` }, { status: 400 });
    }
    const schema = await getDmSchemaSafe(brand);

    const prevMonth = (() => {
      const [y, m] = month.split('-').map(Number);
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return `${py}-${String(pm).padStart(2, '0')}`;
    })();

    let snapshot: SnapshotResponse;
    let trend: TrendResponse;
    try {
      const cur = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE to_char(month, 'YYYY-MM') = $1 AND store_code = $2`,
        [month, store]
      );
      if (cur.rows.length === 0) {
        return NextResponse.json({ success: false, data: null, error: 'No data' }, { status: 404 });
      }
      const prev = await pool.query(
        `SELECT * FROM ${schema}.v_store_monthly_kpi WHERE to_char(month, 'YYYY-MM') = $1 AND store_code = $2`,
        [prevMonth, store]
      );

      const toKpi = (r: any): StoreKpi => ({
        month: r.month instanceof Date
          ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
          : String(r.month),
        revenue_amt: Number(r.revenue_amt), cost_amt: Number(r.cost_amt), expense_amt: Number(r.expense_amt),
        hr_amt: Number(r.hr_amt), rent_amt: Number(r.rent_amt),
        gross_profit_amt: Number(r.gross_profit_amt), net_profit_amt: Number(r.net_profit_amt),
        operating_cf_amt: Number(r.operating_cf_amt), total_in_amt: Number(r.total_in_amt), total_out_amt: Number(r.total_out_amt),
        cash_balance: Number(r.cash_balance), loan_balance: Number(r.loan_balance),
        cashflow_runway_months: r.cashflow_runway_months == null ? null : Number(r.cashflow_runway_months),
        hr_ratio_pct: r.hr_ratio_pct == null ? null : Number(r.hr_ratio_pct),
        rent_ratio_pct: r.rent_ratio_pct == null ? null : Number(r.rent_ratio_pct),
        gross_profit_rate_pct: r.gross_profit_rate_pct == null ? null : Number(r.gross_profit_rate_pct),
        net_profit_rate_pct: r.net_profit_rate_pct == null ? null : Number(r.net_profit_rate_pct),
      });
      snapshot = { current: toKpi(cur.rows[0]), previous: prev.rows[0] ? toKpi(prev.rows[0]) : null };

      const tr = await pool.query(
        `SELECT month, revenue_amt, cost_amt, expense_amt, hr_amt, rent_amt,
                gross_profit_amt, gross_profit_rate_pct,
                net_profit_amt, net_profit_rate_pct,
                operating_cf_amt, cash_balance, loan_balance, cashflow_runway_months,
                hr_ratio_pct, rent_ratio_pct
         FROM ${schema}.v_store_monthly_kpi
         WHERE store_code = $1
         ORDER BY month DESC LIMIT 12`,
        [store]
      );
      const sorted = tr.rows.reverse();
      const keys: KpiMetricKey[] = [
        'revenue_amt', 'cost_amt', 'expense_amt', 'hr_amt', 'rent_amt',
        'gross_profit_amt', 'gross_profit_rate_pct',
        'net_profit_amt', 'net_profit_rate_pct',
        'operating_cf_amt', 'cash_balance', 'loan_balance', 'cashflow_runway_months',
        'hr_ratio_pct', 'rent_ratio_pct',
      ];
      const series = {} as Record<KpiMetricKey, (number | null)[]>;
      for (const k of keys) series[k] = [];
      const monthList: string[] = [];
      for (const r of sorted) {
        const m = r.month instanceof Date
          ? `${r.month.getFullYear()}-${String(r.month.getMonth() + 1).padStart(2, '0')}`
          : String(r.month);
        monthList.push(m);
        for (const k of keys) {
          const v = r[k as string];
          series[k].push(v == null ? null : Number(v));
        }
      }
      trend = { months: monthList, series };
    } catch (e: any) {
      if (e?.code === PG_ERR_NO_VIEW) {
        return NextResponse.json({ success: true, data: null, note: 'view not ready' });
      }
      throw e;
    }

    const wb = buildStoreReportWorkbook({
      brand, store, month, generatedAt: new Date(), snapshot, trend,
    });
    const buf = workbookToBuffer(wb);

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${brand}_${store}_${month}.xlsx"`,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json({ success: false, data: null, error: getErrorMessage(err) }, { status: 500 });
  }
}
