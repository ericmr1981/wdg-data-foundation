import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getCfgSchema } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';

interface PaymentLvl1Row {
  lvl1_code: string;
  lvl1_name: string;
  amount: string;
}

interface PaymentTrendRow {
  month: string;
  amount: string;
}

// GET /api/financial/payment-metrics?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
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
      dateClause = 'AND month >= $1::date AND month < $2::date';
      params.push(boundaries[0], boundaries[1]);
    }
    if (store !== 'all') {
      storeClause = `AND store_code = $${params.length + 1}`;
      params.push(store);
    }

    // Total outgoing + lvl1 breakdown (no JOIN needed, lookup lvl1 names separately)
    const totalParams = [...params];
    const totalAndLvl1Query = `
      SELECT lvl1_code, sum(abs(net_amount)) as amount
      FROM ${dmSchema}.v_cashflow_statement
      WHERE net_amount < 0 ${dateClause} ${storeClause}
      GROUP BY lvl1_code
      ORDER BY amount DESC
    `;

    // Dim lookup for lvl1 names
    const dimQuery = `SELECT lvl1_code, lvl1_name FROM ${cfgSchema}.dim_category_lvl1`;

    // Monthly trend (last 12 months, respects store filter only)
    const trendStoreClause = store !== 'all' ? 'AND store_code = $1' : '';
    const trendParams: (string | number)[] = store !== 'all' ? [store] : [];
    const trendQuery = `
      SELECT to_char(month, 'YYYY-MM') as month, sum(abs(net_amount)) as amount
      FROM ${dmSchema}.v_cashflow_statement
      WHERE net_amount < 0 ${trendStoreClause}
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `;

    const [lvl1Res, dimRes, trendRes] = await Promise.all([
      pool.query(totalAndLvl1Query, totalParams),
      pool.query(dimQuery),
      pool.query(trendQuery, trendParams),
    ]);

    const dimMap = new Map((dimRes.rows as { lvl1_code: string; lvl1_name: string }[]).map(r => [r.lvl1_code, r.lvl1_name]));

    const byLvl1 = (lvl1Res.rows as PaymentLvl1Row[]).map(r => ({
      lvl1_code: r.lvl1_code,
      lvl1_name: dimMap.get(r.lvl1_code) || r.lvl1_code,
      amount: Number(r.amount),
    }));

    const totalOut = byLvl1.reduce((s, r) => s + r.amount, 0);

    const monthlyTrend = (trendRes.rows as PaymentTrendRow[])
      .map(r => ({ month: r.month, amount: Number(r.amount) }))
      .reverse();

    return NextResponse.json({
      success: true,
      data: { total_out: totalOut, by_lvl1: byLvl1, monthly_trend: monthlyTrend },
    });
  } catch (error: unknown) {
    const errRecord = error as Record<string, unknown>;
    if (errRecord?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in payment-metrics route:', error);
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status });
  }
}
