import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getErrorMessage } from '@/lib/query-types';
import { parsePeriod } from '../period-utils';

// GET /api/financial/kpi-trend?brand=x&period=2026-06&span=month&store=xxx
// Returns:
//   - monthly[]: 12-month trend (unfiltered by period, for chart)
//   - current_month / prev_month: filtered by period+span (for expense breakdown)
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || '';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';
    const brand = normalizeBrand(brandParam);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const boundaries = parsePeriod(period, span);
    if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
    const [startDate, endDate] = boundaries;

    const dmSchema = await getDmSchemaSafe(brand);
    const storeClause = store !== 'all' ? 'AND t.store_code = $1' : '';
    const storeParams = store !== 'all' ? [store] : [];

    // ── Trend data — always last 12 months, unfiltered by period ──
    const profitTrend = await pool.query(
      `SELECT
        to_char(date_trunc('month', t.txn_time)::date, 'YYYY-MM') as month,
        COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_OTHER' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as rev_other,
        COALESCE(SUM(CASE WHEN c.lvl1_code = 'MATERIAL' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as material_cost,
        COALESCE(SUM(coalesce(t.in_amt,0) - coalesce(t.out_amt,0)), 0) as net_profit,
        COALESCE(ABS(SUM(CASE WHEN c.lvl1_code IN ('MATERIAL','HR','RENT_UTIL','MKT','ADMIN','SHIP','TAX_SURCHARGE','EXP_OTHER','BUILD') THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END)), 0) as expenses,
        COALESCE(ABS(SUM(CASE WHEN c.lvl1_code IN ('HR','MKT','RENT_UTIL','SHIP','ADMIN') THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END)), 0) as non_cogs_exp
      FROM ${dmSchema}.bank_txn_classified_snapshot c
      JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
      WHERE c.classified_source IN ('rule', 'override') ${storeClause}
      GROUP BY date_trunc('month', t.txn_time)::date
      ORDER BY month DESC
      LIMIT 12`,
      storeParams
    );

    const npTrend = await pool.query(
      `SELECT
         to_char(month, 'YYYY-MM') as m,
         AVG(net_profit_rate_pct) as rate_pct
       FROM ${dmSchema}.v_store_monthly_kpi
       WHERE month >= (current_date - interval '12 months')::date
         ${store !== 'all' ? 'AND store_code = $1' : ''}
       GROUP BY 1`,
      store !== 'all' ? [store] : []
    );
    const npTrendMap = new Map<string, number>(
      (npTrend.rows as { m: string; rate_pct: string }[]).map(r => [r.m, Number(r.rate_pct) / 100])
    );

    const cfTrend = await pool.query(
      `SELECT
        to_char(date_trunc('month', t.txn_time)::date, 'YYYY-MM') as month,
        COALESCE(SUM(CASE
          WHEN c.lvl1_code IN ('REV_BIZ','HR','MATERIAL','RENT_UTIL','MKT','ADMIN','SHIP','TAX_SURCHARGE','EXP_OTHER')
            OR (c.lvl1_code = 'REV_OTHER' AND c.lvl2_code IN ('INTEREST_IN','REFUND_IN','TAX_REFUND'))
          THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0)
          ELSE 0
        END), 0) as operating_cashflow
      FROM ${dmSchema}.bank_txn_classified_snapshot c
      JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
      WHERE c.classified_source IN ('rule', 'override') ${storeClause}
      GROUP BY date_trunc('month', t.txn_time)::date
      ORDER BY month DESC
      LIMIT 12`,
      storeParams
    );

    // Build monthly trend
    const profitMap = new Map<string, { revenue: number; revOther: number; material: number; net: number; expenses: number; nonCogsExp: number }>();
    for (const r of profitTrend.rows) profitMap.set(r.month, {
      revenue: Number(r.revenue),
      revOther: Number(r.rev_other),
      material: Number(r.material_cost),
      net: Number(r.net_profit),
      expenses: Number(r.expenses),
      nonCogsExp: Number(r.non_cogs_exp),
    });

    const cfMap = new Map<string, number>();
    for (const r of cfTrend.rows) cfMap.set(r.month, Number(r.operating_cashflow));

    // Unified formula: tamkoko cogs comes from v_cogs_monthly via the view's monthly[].gross_margin_rate.
    // No special cogsMap needed here.
    let cogsMap: Map<string, number> = new Map();

    const allMonths = Array.from(new Set([...profitMap.keys(), ...cfMap.keys()])).sort();
    const monthly = allMonths.slice(0, 12).map(m => {
      const p = profitMap.get(m);
      const cf = cfMap.get(m);
      const rev = p?.revenue || 0;
      const revOther = p?.revOther || 0;
      const nonCogsExp = p?.nonCogsExp || 0;
      let grossMarginRate: number;
      if (brand === 'tamkoko' && cogsMap.has(m)) {
        const cogs = cogsMap.get(m)!;
        const cogsRevenue = rev + revOther;
        grossMarginRate = cogsRevenue > 0 ? (cogsRevenue - cogs) / cogsRevenue : 0;
      } else {
        grossMarginRate = rev > 0 ? (rev + (p?.material || 0)) / rev : 0;
      }
      return {
        month: m,
        revenue: rev,
        gross_margin_rate: grossMarginRate,
        net_profit_rate: npTrendMap.get(m) ?? null,
        operating_cashflow: cf || 0,
        expenses: p?.expenses || 0,
      };
    });

    // ── Current / previous month expenses filtered by period+store ──
    const expParams: (string | number)[] = [startDate, endDate];
    if (store !== 'all') expParams.push(store);

    const expenseTrend = await pool.query(
      `WITH actuals AS (
        SELECT
          c.lvl1_code,
          c.lvl2_code,
          COALESCE(SUM(coalesce(t.out_amt,0) - coalesce(t.in_amt,0)), 0) as amount
        FROM ${dmSchema}.bank_txn_classified_snapshot c
        JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
        WHERE c.classified_source IN ('rule', 'override')
          AND t.txn_time >= $1::date AND t.txn_time < $2::date${store !== 'all' ? ' AND t.store_code = $3' : ''}
        GROUP BY c.lvl1_code, c.lvl2_code
      )
      SELECT
        l1.lvl1_code,
        l1.lvl1_name,
        l2.lvl2_code,
        l2d.lvl2_name,
        COALESCE(a.amount, 0) as amount
      FROM (SELECT DISTINCT lvl2_code, lvl1_code FROM ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl2 WHERE lvl1_code IN (
        SELECT lvl1_code FROM ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl1 WHERE direction = 'out' AND enabled = true
      )) l2
      JOIN ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl1 l1 ON l1.lvl1_code = l2.lvl1_code
      JOIN ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl2 l2d ON l2d.lvl1_code = l2.lvl1_code AND l2d.lvl2_code = l2.lvl2_code
      LEFT JOIN actuals a ON a.lvl1_code = l2.lvl1_code AND a.lvl2_code = l2.lvl2_code
      ORDER BY l1.sort_order, l2d.lvl2_code`,
      expParams
    );

    // Previous month expenses — calculate from period string
    let prevPeriodStr = '';
    if (span === 'month') {
      const [y, m] = period.split('-');
      const pm = Number(m) - 1;
      if (pm < 1) prevPeriodStr = `${Number(y) - 1}-12`;
      else prevPeriodStr = `${y}-${String(pm).padStart(2, '0')}`;
    }
    const prevBoundaries = prevPeriodStr ? parsePeriod(prevPeriodStr, 'month') : null;
    const prevParams: (string | number)[] = prevBoundaries ? [prevBoundaries[0], prevBoundaries[1]] : [startDate, endDate];
    if (store !== 'all') prevParams.push(store);

    const prevExpenseTrend = await pool.query(
      `WITH actuals AS (
        SELECT
          c.lvl1_code,
          c.lvl2_code,
          COALESCE(SUM(coalesce(t.out_amt,0) - coalesce(t.in_amt,0)), 0) as amount
        FROM ${dmSchema}.bank_txn_classified_snapshot c
        JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
        WHERE c.classified_source IN ('rule', 'override')
          AND t.txn_time >= $1::date AND t.txn_time < $2::date${store !== 'all' ? ' AND t.store_code = $3' : ''}
        GROUP BY c.lvl1_code, c.lvl2_code
      )
      SELECT
        l1.lvl1_code,
        l1.lvl1_name,
        l2.lvl2_code,
        l2d.lvl2_name,
        COALESCE(a.amount, 0) as amount
      FROM (SELECT DISTINCT lvl2_code, lvl1_code FROM ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl2 WHERE lvl1_code IN (
        SELECT lvl1_code FROM ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl1 WHERE direction = 'out' AND enabled = true
      )) l2
      JOIN ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl1 l1 ON l1.lvl1_code = l2.lvl1_code
      JOIN ${dmSchema.replace('_dm', '_cfg')}.dim_category_lvl2 l2d ON l2d.lvl1_code = l2.lvl1_code AND l2d.lvl2_code = l2.lvl2_code
      LEFT JOIN actuals a ON a.lvl1_code = l2.lvl1_code AND a.lvl2_code = l2.lvl2_code`,
      prevParams
    );

    // Build current / prev expense maps
    const currentExpenses = expenseTrend.rows.map(r => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: r.lvl1_name || r.lvl1_code,
      lvl2_code: r.lvl2_code || '',
      lvl2_name: r.lvl2_name || '',
      amount: Number(r.amount),
    }));

    const prevExpenses = prevExpenseTrend.rows.map(r => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: r.lvl1_name || r.lvl1_code,
      lvl2_code: r.lvl2_code || '',
      lvl2_name: r.lvl2_name || '',
      amount: Number(r.amount),
    }));

    // Revenue for selected period
    const revRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue
       FROM ${dmSchema}.bank_txn_classified_snapshot c
       JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
       WHERE c.classified_source IN ('rule', 'override')
         AND t.txn_time >= $1::date AND t.txn_time < $2::date${store !== 'all' ? ' AND t.store_code = $3' : ''}`,
      expParams
    );
    const currentRevenue = Number(revRes.rows[0]?.revenue || 0);

    const prevRevRes = await pool.query(
      `SELECT COALESCE(SUM(CASE WHEN c.lvl1_code = 'REV_BIZ' THEN coalesce(t.in_amt,0) - coalesce(t.out_amt,0) ELSE 0 END), 0) as revenue
       FROM ${dmSchema}.bank_txn_classified_snapshot c
       JOIN ${dmSchema.replace('_dm', '_ods')}.bank_txn t ON t.id = c.bank_txn_id
       WHERE c.classified_source IN ('rule', 'override')
         AND t.txn_time >= $1::date AND t.txn_time < $2::date${store !== 'all' ? ' AND t.store_code = $3' : ''}`,
      prevParams
    );
    const prevRevenue = Number(prevRevRes.rows[0]?.revenue || 0);

    return NextResponse.json({
      success: true,
      data: {
        monthly,
        current_month: { revenue: currentRevenue, expenses: currentExpenses },
        prev_month: { revenue: prevRevenue, expenses: prevExpenses },
      },
    });
  } catch (error: unknown) {
    if ((error as Record<string, string>)?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in kpi-trend route:', error);
    const status = (error as Record<string, number>)?.status || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status });
  }
}
