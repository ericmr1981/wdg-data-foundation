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

interface CashflowRow {
  activity: string;
  lvl1_code: string;
  lvl2_code: string;
  total_in: string;
  total_out: string;
  net_amount: string;
}

// Reuse parsePeriod from profit route
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
    return [
      `${year}-${String(startM).padStart(2, '0')}-01`,
      `${year}-${String(startM + 3).padStart(2, '0')}-01`,
    ];
  }
  if (span === 'year') {
    if (!/^\d{4}$/.test(period)) return null;
    return [`${period}-01-01`, `${Number(period) + 1}-01-01`];
  }
  return null;
}

function buildCashflowLines(raw: CashflowRow[]): LineItem[] {
  const lines: LineItem[] = [];
  const operating = raw.filter(r => r.activity === 'operating');
  const investing = raw.filter(r => r.activity === 'investing');
  const financing = raw.filter(r => r.activity === 'financing');

  const toNum = (v: string) => Number(v);

  // Operating inflows
  const opInflows = operating.filter(r => toNum(r.net_amount) > 0);
  const opOutflows = operating.filter(r => toNum(r.net_amount) < 0);
  const opInflowTotal = opInflows.reduce((s, r) => s + toNum(r.total_in), 0);
  const opOutflowTotal = opOutflows.reduce((s, r) => s + toNum(r.total_out), 0);
  const opNet = opInflowTotal - opOutflowTotal;

  lines.push({ section: 'operating_header', label: '一、经营活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of opInflows) {
    lines.push({ section: 'operating_in_detail', label: `  ${r.lvl1_code === 'REV_BIZ' ? '销售商品收到的现金' : r.lvl1_code + '/' + (r.lvl2_code || '')}`, amount: toNum(r.total_in), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opInflows.length > 0) {
    lines.push({ section: 'operating_in', label: '  经营活动现金流入小计', amount: opInflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  for (const r of opOutflows) {
    lines.push({ section: 'operating_out_detail', label: `  ${r.lvl1_code === 'HR' ? '支付给职工的现金' : r.lvl1_code === 'MATERIAL' ? '购买商品支付的现金' : (r.lvl1_code === 'EXP_OTHER' && r.lvl2_code === 'TAX') ? '支付的各项税费' : r.lvl1_code}`, amount: -toNum(r.total_out), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opOutflows.length > 0) {
    lines.push({ section: 'operating_out', label: '  经营活动现金流出小计', amount: -opOutflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  lines.push({ section: 'operating_net', label: '经营活动产生的现金流量净额', amount: opNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Investing
  const invNet = investing.reduce((s, r) => s + toNum(r.net_amount), 0);
  lines.push({ section: 'investing_header', label: '二、投资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of investing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'investing_detail', label: `  ${r.lvl1_code === 'BUILD' ? '购建固定资产支付的现金' : r.lvl1_code + '/' + (r.lvl2_code || '')}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'investing_net', label: '投资活动产生的现金流量净额', amount: invNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Financing
  const finNet = financing.reduce((s, r) => s + toNum(r.net_amount), 0);
  lines.push({ section: 'financing_header', label: '三、筹资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of financing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'financing_detail', label: `  ${r.lvl2_code === 'LOAN_IN' ? '取得借款收到的现金' : r.lvl2_code === 'BORROW_IN' ? '收到借款' : r.lvl2_code === 'REPAY' ? '偿还债务支付的现金' : r.lvl2_code || r.lvl1_code}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'financing_net', label: '筹资活动产生的现金流量净额', amount: finNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Net increase
  const totalNet = opNet + invNet + finNet;
  lines.push({ section: 'total_net', label: '四、现金净增加额', amount: totalNet, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/cashflow?brand=gelatomiiix&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const period = searchParams.get('period') || '';
    const span = searchParams.get('span') || 'month';
    const store = searchParams.get('store') || 'all';

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
    const viewName = `${dmSchema}.v_cashflow_statement`;

    const params: (string | number)[] = [startDate, endDate];
    let storeClause = '';
    if (store !== 'all') {
      storeClause = 'AND store_code = $3';
      params.push(store);
    }

    const query = `
      SELECT activity, lvl1_code, lvl2_code,
             sum(total_in) as total_in,
             sum(total_out) as total_out,
             sum(net_amount) as net_amount
      FROM ${viewName}
      WHERE month >= $1::date AND month < $2::date ${storeClause}
      GROUP BY activity, lvl1_code, lvl2_code
      ORDER BY min(sort_order)
    `;

    const result = await pool.query(query, params);
    const lines = buildCashflowLines(result.rows);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    console.error('Error in cashflow route:', error);
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load cashflow statement' }, { status });
  }
}
