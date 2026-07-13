import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getCfgSchema } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';
import { getIncomeMetrics } from '@/lib/repositories/financial-repository';

interface Lvl1Row {
  lvl1_code: string;
  lvl1_name: string;
  amount: string;
}

interface Lvl2Row {
  lvl1_code: string;
  lvl2_code: string;
  amount: string;
}

interface TrendRow {
  month: string;
  amount: string;
}

// GET /api/financial/income-metrics?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser(request);
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'all';
  const span = searchParams.get('span') || 'month';
  const store = searchParams.get('store') || 'all';

  try {
    assertRole(user, ['admin', 'operator']);

    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const brand = normalizeBrand(brandParam);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    let dmSchema: string;
    let cfgSchema: string;
    try {
      dmSchema = await getDmSchemaSafe(brand);
      cfgSchema = getCfgSchema(brand);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as Record<string, unknown>).status === 400) {
        return NextResponse.json({ success: false, error: getErrorMessage(err) }, { status: 400 });
      }
      throw err;
    }

    const isAll = period === 'all';
    const boundaries = isAll ? null : parsePeriod(period, span);
    if (!isAll && !boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });

    const params: (string | number)[] = [];
    let dateClause = '';
    let storeClause = '';

    if (!isAll && boundaries) {
      // 精确期间: 所选月份/季度/年
      dateClause = 'AND month >= $1::date AND month < $2::date';
      params.push(boundaries[0], boundaries[1]);
    }
    if (store !== 'all') {
      storeClause = `AND store_code = $${params.length + 1}`;
      params.push(store);
    }

    // Lvl2 breakdown
    const lvl2Query = `
      SELECT lvl1_code, lvl2_code, sum(net_amount) as amount
      FROM ${dmSchema}.v_cashflow_statement
      WHERE net_amount > 0 ${dateClause} ${storeClause}
      GROUP BY lvl1_code, lvl2_code
      ORDER BY amount DESC
    `;

    // Dim lookup for lvl1 names
    const dimLvl1Query = `SELECT lvl1_code, lvl1_name FROM ${cfgSchema}.dim_category_lvl1`;

    // Dim lookup for lvl2 names
    const dimLvl2Query = `SELECT lvl1_code, lvl2_code, lvl2_name FROM ${cfgSchema}.dim_category_lvl2`;

    // Monthly trend (trailing 12 months up to period end, respects store filter only)
    const trendParams: (string | number)[] = [];
    let trendDateClause = '';
    if (!isAll && boundaries) {
      trendDateClause = 'AND month < $' + (trendParams.length + 1) + '::date';
      trendParams.push(boundaries[1]);
    }
    if (store !== 'all') {
      trendDateClause += ' AND store_code = $' + (trendParams.length + 1);
      trendParams.push(store);
    }
    const trendQuery = `
      SELECT to_char(month, 'YYYY-MM') as month, sum(net_amount) as amount
      FROM ${dmSchema}.v_cashflow_statement
      WHERE net_amount > 0 ${trendDateClause}
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `;

    const lvl1Result = await getIncomeMetrics(dmSchema, cfgSchema, period, span, store);
    const [lvl2Res, dimLvl1Res, dimLvl2Res, trendRes] = await Promise.all([
      pool.query(lvl2Query, params),
      pool.query(dimLvl1Query),
      pool.query(dimLvl2Query),
      pool.query(trendQuery, trendParams),
    ]);

    const lvl1NameMap = new Map((dimLvl1Res.rows as { lvl1_code: string; lvl1_name: string }[]).map(r => [r.lvl1_code, r.lvl1_name]));
    const lvl2NameMap = new Map(
      (dimLvl2Res.rows as { lvl1_code: string; lvl2_code: string; lvl2_name: string }[])
        .map(r => [`${r.lvl1_code}:${r.lvl2_code}`, r.lvl2_name])
    );

    const byLvl1 = lvl1Result.map(r => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: lvl1NameMap.get(r.lvl1_code) || r.lvl1_code,
      amount: Number(r.amount),
    }));

    const byLvl2 = (lvl2Res.rows as Lvl2Row[]).map(r => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: lvl1NameMap.get(r.lvl1_code) || r.lvl1_code,
      lvl2_code: r.lvl2_code,
      lvl2_name: lvl2NameMap.get(`${r.lvl1_code}:${r.lvl2_code}`) || r.lvl2_code,
      amount: Number(r.amount),
    }));

    const totalIn = byLvl1.reduce((s, r) => s + r.amount, 0);

    const monthlyTrend = (trendRes.rows as TrendRow[])
      .map(r => ({ month: r.month, amount: Number(r.amount) }))
      .reverse();

    return NextResponse.json({
      success: true,
      data: { total_in: totalIn, by_lvl1: byLvl1, by_lvl2: byLvl2, monthly_trend: monthlyTrend },
    });
  } catch (error: unknown) {
    const errRecord = error as Record<string, unknown>;
    if (errRecord?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in income-metrics route:', error);
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status });
  }
}
