import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getOdsSchema } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';
import {
  getFinancialOverview,
  getBeginningBalance,
  getActiveStoreCount,
  getKpiRate,
  getOperatingExpenses,
} from '@/lib/repositories/financial-repository';

function getPrevPeriod(period: string, span: string): string {
  if (span === 'month') {
    const [y, m] = period.split('-');
    const pm = Number(m) - 1;
    return pm < 1 ? `${Number(y) - 1}-12` : `${y}-${String(pm).padStart(2, '0')}`;
  }
  if (span === 'quarter') {
    const [y, q] = period.split('-Q');
    return q === '1' ? `${Number(y) - 1}-Q4` : `${y}-Q${Number(q) - 1}`;
  }
  if (span === 'year') {
    return String(Number(period) - 1);
  }
  return '';
}

export async function GET(request: Request) {
  const user = await getSessionUser(request);
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

    let dmSchema: string;
    try {
      dmSchema = await getDmSchemaSafe(brand);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as Record<string, unknown>).status === 400) {
        return NextResponse.json({ success: false, error: getErrorMessage(err) }, { status: 400 });
      }
      throw err;
    }
    const odsSchema = brand === 'gelatomiiix' ? 'gelatomiiix_ods' : getOdsSchema(brand);

    const [
      overview,
      beginBalanceRes,
      storeCount,
      npRate,
      gmRate,
      expenses,
    ] = await Promise.all([
      getFinancialOverview(dmSchema, odsSchema, period, span, store),
      getBeginningBalance(dmSchema, period, span, store),
      getActiveStoreCount(dmSchema, period, span, store),
      getKpiRate(dmSchema, period, span, store, 'net_profit_rate_pct'),
      getKpiRate(dmSchema, period, span, store, 'gross_profit_rate_pct'),
      getOperatingExpenses(dmSchema, period, span, store),
    ]);

    const pMap = new Map(overview.profit.map(r => [r.lvl1_code, Number(r.amount)]));
    const revenue = pMap.get('REV_BIZ') || 0;
    const materialCost = pMap.get('MATERIAL') || 0;
    const allProfits = Array.from(pMap.values()).reduce((s: number, v: number) => s + v, 0);

    // Unified formula (all brands). gross_profit_rate_pct from v_store_monthly_kpi is the
    // source of truth: for tamkoko it derives from cogs (v_cogs_monthly), and therefore
    // depends on inventory_monthly_summary. For brands without inventory it falls back to
    // the bank-MATERIAL approximation inside the view. Only fall back to the local bank
    // approximation when the view itself returns NULL (e.g. all months in range lack opening).
    let grossMarginRate: number | null;
    const gmFromView = gmRate;
    if (gmFromView != null) {
      grossMarginRate = gmFromView;
    } else {
      grossMarginRate = revenue > 0 && materialCost < 0 ? (revenue + materialCost) / revenue : null;
    }
    const netProfitRate = npRate ?? 0;

    // Qimai-based gross margin (营业净收 / 营业额). Uses the same COGS as the bank-based formula.
    // Both numbers share the same cost base; only the revenue denominator differs.
    //   - 营业净收毛利率 = (净收入 − COGS) / 净收入    (主显示 — 跟平台口径一致)
    //   - 营业额毛利率   = (营业额 − COGS) / 营业额    (副显示 — 含优惠/折扣)
    // Returns null when qimai data is unavailable (brand without income_detail) or
    // when COGS is null (no inventory, no approximation) — we do NOT silently fall back
    // to the bank-MATERIAL approximation here, to keep the qimai view honest.
    const cogsTotal: number | null = overview.cogs_total != null
      ? Number(overview.cogs_total) : null;
    const qimaiNet: number | null = overview.qimai_net != null
      ? Number(overview.qimai_net) : null;
    const qimaiGross: number | null = overview.qimai_gross != null
      ? Number(overview.qimai_gross) : null;
    const grossMarginRateQimaiNet: number | null =
      qimaiNet != null && cogsTotal != null && qimaiNet > 0
        ? (qimaiNet - cogsTotal) / qimaiNet : null;
    const grossMarginRateQimaiGross: number | null =
      qimaiGross != null && cogsTotal != null && qimaiGross > 0
        ? (qimaiGross - cogsTotal) / qimaiGross : null;
    const operatingCashflow = Number(overview.cashflow.find(r => r.activity === 'operating')?.net_amount || 0);
    const cashBalance = Number(overview.balance?.cash_balance || 0);
    const beginningBalance = Number(beginBalanceRes[0]?.cash_balance || 0);

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
    const prevPeriodStr = getPrevPeriod(period, span);
    let vsRevenue = 0, vsGm = 0, vsNp = 0, vsOcf = 0;

    if (prevPeriodStr) {
      const [prevOverview, prevNpRate, prevGmRate] = await Promise.all([
        getFinancialOverview(dmSchema, odsSchema, prevPeriodStr, span, store),
        getKpiRate(dmSchema, prevPeriodStr, span, store, 'net_profit_rate_pct'),
        getKpiRate(dmSchema, prevPeriodStr, span, store, 'gross_profit_rate_pct'),
      ]);

      const prevMap = new Map(prevOverview.profit.map(r => [r.lvl1_code, Number(r.amount)]));
      const prevRev = prevMap.get('REV_BIZ') || 0;
      const prevMat = prevMap.get('MATERIAL') || 0;
      const prevOcf = Number(prevOverview.cashflow.find(r => r.activity === 'operating')?.net_amount || 0);

      vsRevenue = (revenue > 0 && prevRev > 0) ? (revenue - prevRev) / prevRev : 0;
      // Match the current-period rule: prefer the view's gross_profit_rate_pct (cogs-based for
      // tamkoko) over the bank-MATERIAL approximation; only fall back when the view returned NULL.
      const prevGmRateVal = prevGmRate != null ? prevGmRate
        : (prevRev > 0 && prevMat < 0 ? (prevRev + prevMat) / prevRev : null);
      vsGm = grossMarginRate != null && prevGmRateVal != null && revenue > 0 ? grossMarginRate - prevGmRateVal : 0;
      // Unified formula (all brands). Use the view's pre-computed prev-period net_profit_rate_pct.
      vsNp = revenue > 0 ? netProfitRate - (prevNpRate ?? 0) : 0;
      vsOcf = prevOcf !== 0 ? (operatingCashflow - prevOcf) / Math.abs(prevOcf) : 0;
    }

    return NextResponse.json({
      success: true,
      data: {
        period, span, store,
        revenue, grossMarginRate, netProfitRate,
        // Qimai-based gross margin (separate from bank-based grossMarginRate above).
        // qimaiNetRevenue / qimaiGrossRevenue are the raw amounts; the rate fields are
        // pre-computed. They share the same COGS as grossMarginRate — only the
        // denominator differs (营业净收 vs 营业额).
        qimaiNetRevenue: qimaiNet,
        qimaiGrossRevenue: qimaiGross,
        grossMarginRateQimaiNet,
        grossMarginRateQimaiGross,
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
    if ((error as { code?: string })?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'view not ready' });
    }
    console.error('Error in overview route:', error);
    return NextResponse.json({ success: false, error: getErrorMessage(error) }, { status: (error as { status?: number })?.status || 500 });
  }
}
