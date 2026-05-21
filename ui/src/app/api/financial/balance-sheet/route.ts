import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

interface BalanceRow {
  month: string;
  store_code: string;
  cash_balance: string;
  loan_balance: string;
  capital_balance: string;
  retained_earnings: string;
}

function parsePeriod(period: string, span: string): [string, string] | null {
  if (span === 'month') {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) return null;
    const [y, m] = period.split('-');
    const nextM = Number(m) + 1;
    return [`${period}-01`, nextM > 12 ? `${Number(y) + 1}-01-01` : `${y}-${String(nextM).padStart(2, '0')}-01`];
  }
  if (span === 'quarter') {
    if (!/^\d{4}-Q[1-4]$/.test(period)) return null;
    const [year, q] = period.split('-Q');
    const startM = (Number(q) - 1) * 3 + 1;
    return [`${year}-${String(startM).padStart(2, '0')}-01`, `${year}-${String(startM + 3).padStart(2, '0')}-01`];
  }
  if (span === 'year') {
    if (!/^\d{4}$/.test(period)) return null;
    return [`${period}-01-01`, `${Number(period) + 1}-01-01`];
  }
  return null;
}

function buildBalanceLines(raw: BalanceRow[]): LineItem[] {
  if (raw.length === 0) return [];

  const r = raw[raw.length - 1];
  const cash = Number(r.cash_balance);
  const loans = Number(r.loan_balance);
  const capital = Number(r.capital_balance);
  const retained = Number(r.retained_earnings);
  const totalAssets = cash;
  const totalLiabilities = loans;
  const totalEquity = capital + retained;
  const lines: LineItem[] = [];

  lines.push({ section: 'asset_header', label: '资产', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'asset_detail', label: '  货币资金', amount: cash, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'asset_total', label: '资产总计', amount: totalAssets, indent: 0, is_subtotal: true, is_highlight: true });

  lines.push({ section: 'liability_header', label: '负债', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_detail', label: '  借款', amount: loans, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_total', label: '负债总计', amount: totalLiabilities, indent: 0, is_subtotal: true, is_highlight: true });

  lines.push({ section: 'equity_header', label: '所有者权益', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  实收资本', amount: capital, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  未分配利润', amount: retained, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_total', label: '所有者权益总计', amount: totalEquity, indent: 0, is_subtotal: true, is_highlight: true });

  lines.push({ section: 'total', label: '负债和所有者权益总计', amount: totalLiabilities + totalEquity, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/balance-sheet?brand=gelatomiiix&period=2026-01&span=month&store=all
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
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!['month', 'quarter', 'year'].includes(span)) {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    const boundaries = parsePeriod(period, span);
    if (!boundaries) {
      return NextResponse.json({ success: false, error: 'Invalid period format' }, { status: 400 });
    }
    const [startDate, endDate] = boundaries;

    let dmSchema: string;
    try {
      dmSchema = await getDmSchemaSafe(brand);
    } catch (err: any) {
      if (err?.status === 400) {
        return NextResponse.json({ success: false, error: err.message }, { status: 400 });
      }
      throw err;
    }
    const viewName = `${dmSchema}.v_balance_sheet`;
    const profitView = `${dmSchema}.v_profit_statement`;

    // Balance sheet is a snapshot at end of period — use the last day
    // endDate is exclusive, so we need the day before
    const lastDay = new Date(endDate);
    lastDay.setDate(lastDay.getDate() - 1);
    const targetDate = lastDay.toISOString().split('T')[0];
    // Find the first of month that this date falls in
    const targetMonth = targetDate.substring(0, 7) + '-01';

    const params: (string | number)[] = [targetMonth];
    const profitParams: (string | number)[] = [targetDate];

    let storeClause = '';
    let profitStoreClause = '';
    if (store !== 'all') {
      storeClause = 'AND store_code = $2';
      profitStoreClause = 'AND store_code = $2';
      params.push(store);
      profitParams.push(store);
    }

    const balanceQuery = `
      SELECT month, store_code, cash_balance, loan_balance, capital_balance, retained_earnings
      FROM ${viewName}
      WHERE month = $1::date ${storeClause}
      ORDER BY store_code, month
    `;

    const profitQuery = `
      SELECT store_code, sum(amount) as retained_earnings
      FROM ${profitView}
      WHERE month <= $1::date ${profitStoreClause}
      GROUP BY store_code
    `;

    const [balanceRes, profitRes] = await Promise.all([
      pool.query(balanceQuery, params),
      pool.query(profitQuery, profitParams),
    ]);

    const profitMap = new Map(profitRes.rows.map(r => [r.store_code, Number(r.retained_earnings)]));
    const merged = balanceRes.rows.map(r => ({
      ...r,
      retained_earnings: profitMap.get(r.store_code) || 0,
    }));

    const lines = buildBalanceLines(merged);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    console.error('Error in balance-sheet route:', error);
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load balance sheet' }, { status });
  }
}
