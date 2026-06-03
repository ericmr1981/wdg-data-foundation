import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getOdsSchema } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { ProfitRow, CashflowRow, BalanceSheetRow, CountRow, getErrorMessage } from '@/lib/query-types';

function getPrevBoundaries(period: string, span: string): [string, string] | null {
  if (span === 'month') {
    const [y, m] = period.split('-');
    let pm = Number(m) - 1, py = Number(y);
    if (pm < 1) { pm = 12; py--; }
    const pp = `${py}-${String(pm).padStart(2, '0')}`;
    return parsePeriod(pp, 'month');
  }
  if (span === 'quarter') {
    const [y, q] = period.split('-Q');
    if (q === '1') return parsePeriod(`${Number(y) - 1}-Q4`, 'quarter');
    return parsePeriod(`${y}-Q${Number(q) - 1}`, 'quarter');
  }
  if (span === 'year') {
    return parsePeriod(String(Number(period) - 1), 'year');
  }
  return null;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '';
  const span = searchParams.get('span') || 'month';
  const store = searchParams.get('store') || 'all';

  try {
    assertRole(user, ['admin', 'operator']);

    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const brand = normalizeBrand(brandParam);
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    if (!['month', 'quarter', 'year'].includes(span)) return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });

    const boundaries = parsePeriod(period, span);
    if (!boundaries) return NextResponse.json({ success: false, error: 'Invalid period' }, { status: 400 });
    const [startDate, endDate] = boundaries;

    let dmSchema: string;
    try {
      dmSchema = await getDmSchemaSafe(brand);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as Record<string, unknown>).status === 400) {
        return NextResponse.json({ success: false, error: getErrorMessage(err) }, { status: 400 });
      }
      throw err;
    }

    // Helper to build params with store clause
    const withStore = (base: (string | number)[]): { params: (string | number)[]; clause: string } => {
      const p = [...base];
      let c = '';
      if (store !== 'all') {
        c = `AND store_code = $${p.length + 1}`;
        p.push(store);
      }
      return { params: p, clause: c };
    };

    // Current period queries
    const cp = withStore([startDate, endDate]);

    const [profitRes, cfRes, balanceRes, storesRes, beginBalanceRes] = await Promise.all([
      pool.query(
        `SELECT lvl1_code, sum(amount) as amount FROM ${dmSchema}.v_profit_statement WHERE month >= $1::date AND month < $2::date ${cp.clause} GROUP BY lvl1_code`,
        cp.params
      ),
      pool.query(
        `SELECT activity, sum(net_amount) as net_amount FROM ${dmSchema}.v_cashflow_statement WHERE month >= $1::date AND month < $2::date ${cp.clause} GROUP BY activity`,
        cp.params
      ),
      pool.query(
        `SELECT cash_balance FROM ${dmSchema}.v_balance_sheet WHERE month < $1::date ${store !== 'all' ? 'AND store_code = $2' : ''} ORDER BY month DESC LIMIT 1`,
        store !== 'all' ? [endDate, store] : [endDate]
      ),
      store === 'all'
        ? pool.query(
            `SELECT count(DISTINCT store_code) as cnt FROM ${dmSchema}.v_profit_statement WHERE month >= $1::date AND month < $2::date`,
            [startDate, endDate]
          )
        : Promise.resolve({ rows: [{ cnt: '1' }] }),
      pool.query(
        `SELECT cash_balance FROM ${dmSchema}.v_balance_sheet WHERE month < $1::date ${store !== 'all' ? 'AND store_code = $2' : ''} ORDER BY month DESC LIMIT 1`,
        store !== 'all' ? [startDate, store] : [startDate]
      ),
    ]);

    const pMap = new Map(profitRes.rows.map((r: ProfitRow) => [r.lvl1_code, Number(r.amount)]));
    const revenue = pMap.get('REV_BIZ') || 0;
    const materialCost = pMap.get('MATERIAL') || 0;
    const allProfits = Array.from(pMap.values()).reduce((s: number, v: number) => s + v, 0);
    // Expenses = total in - net profit = sum of all out-direction amounts
    const expenses = revenue + (pMap.get('REV_OTHER') || 0) - allProfits;
    const grossMarginRate = revenue > 0 ? (revenue + materialCost) / revenue : 0;
    const netProfitRate = revenue > 0 ? allProfits / revenue : 0;
    const operatingCashflow = Number(cfRes.rows.find((r: CashflowRow) => r.activity === 'operating')?.net_amount || 0);
    const cashBalance = Number(balanceRes.rows[0]?.cash_balance || 0);
    const beginningBalance = Number(beginBalanceRes.rows[0]?.cash_balance || 0);
    const storeCount = Number((storesRes.rows[0] as CountRow | undefined)?.cnt || 0);

    // Ignore records count (offset/cancellation with negative amount)
    let ignoreCount = 0;
    try {
      const odsSchema = getOdsSchema(brand);
      const icRes = await pool.query(
        `SELECT count(*) as cnt FROM ${dmSchema}.bank_txn_classified_snapshot WHERE classified_source = 'ignore' ${store !== 'all' ? `AND bank_txn_id IN (SELECT id FROM ${odsSchema}.bank_txn WHERE store_code = $1)` : ''}`,
        store !== 'all' ? [store] : []
      );
      ignoreCount = Number(icRes.rows[0]?.cnt || 0);
    } catch { /* ignore errors */ }

    let cashRunway: number | null = null;
    if (operatingCashflow < 0) {
      const burn = Math.abs(operatingCashflow);
      cashRunway = burn > 0 ? Math.round((cashBalance / burn) * 10) / 10 : null;
    }

    const revenuePerStore = storeCount > 0 ? Math.round((revenue / storeCount) * 100) / 100 : 0;

    // Previous period for comparison
    const prevBounds = getPrevBoundaries(period, span);
    let vsRevenue = 0, vsGm = 0, vsNp = 0, vsOcf = 0;

    if (prevBounds) {
      const pp = withStore(prevBounds);
      const [prevProfitRes, prevCfRes] = await Promise.all([
        pool.query(
          `SELECT lvl1_code, sum(amount) as amount FROM ${dmSchema}.v_profit_statement WHERE month >= $1::date AND month < $2::date ${pp.clause} GROUP BY lvl1_code`,
          pp.params
        ),
        pool.query(
          `SELECT sum(net_amount) as net_amount FROM ${dmSchema}.v_cashflow_statement WHERE activity = 'operating' AND month >= $1::date AND month < $2::date ${pp.clause}`,
          pp.params
        ),
      ]);

      const prevMap = new Map(prevProfitRes.rows.map((r: ProfitRow) => [r.lvl1_code, Number(r.amount)]));
      const prevRev = prevMap.get('REV_BIZ') || 0;
      const prevMat = prevMap.get('MATERIAL') || 0;
      const prevNet = Array.from(prevMap.values()).reduce((s: number, v: number) => s + v, 0);
      const prevOcf = Number(prevCfRes.rows[0]?.net_amount || 0);

      vsRevenue = (revenue > 0 && prevRev > 0) ? (revenue - prevRev) / prevRev : 0;
      vsGm = (revenue > 0 && prevRev > 0) ? ((revenue + materialCost) / revenue) - ((prevRev + prevMat) / prevRev) : 0;
      vsNp = (revenue > 0 && prevRev > 0) ? (allProfits / revenue) - (prevNet / prevRev) : 0;
      vsOcf = prevOcf !== 0 ? (operatingCashflow - prevOcf) / Math.abs(prevOcf) : 0;
    }

    return NextResponse.json({
      success: true,
      data: {
        period, span, store,
        revenue, grossMarginRate, netProfitRate,
        operatingCashflow, cashBalance, cashRunway,
        storeCount, revenuePerStore,
        ignoreCount, beginningBalance, expenses,
        vsPrevPeriod: {
          revenue: vsRevenue,
          grossMarginRate: vsGm,
          netProfitRate: vsNp,
          operatingCashflow: vsOcf,
        },
      },
    });
  } catch (error: unknown) {
    if ((error as Record<string, string>)?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in overview route:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: (error as Record<string, number>)?.status || 500 });
  }
}
