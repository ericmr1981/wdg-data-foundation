import { NextResponse } from 'next/server';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';
import { getCashflowStatement, getInventoryChange } from '@/lib/repositories/financial-repository';

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

function buildCashflowLines(raw: CashflowRow[], inventoryAdj: number = 0): LineItem[] {
  const lines: LineItem[] = [];
  const operating = raw.filter(r => r.activity === 'operating');
  const investing = raw.filter(r => r.activity === 'investing');
  const financing = raw.filter(r => r.activity === 'financing');
  const unclassified = raw.filter(r => r.activity === 'unclassified' || r.activity === null);

  const toNum = (v: string) => Number(v);

  // Operating inflows
  const opInflows = operating.filter(r => toNum(r.net_amount) > 0);
  const opOutflows = operating.filter(r => toNum(r.net_amount) < 0);
  const opInflowTotal = opInflows.reduce((s, r) => s + toNum(r.total_in), 0);
  const opOutflowTotal = opOutflows.reduce((s, r) => s + toNum(r.total_out), 0);
  const opNet = opInflowTotal - opOutflowTotal;

  const labelForOpOutflow = (r: CashflowRow) => {
    if (r.lvl1_code === 'HR') return '支付给职工的现金';
    if (r.lvl1_code === 'MATERIAL') return '购买商品支付的现金';
    if (r.lvl1_code === 'TAX_SURCHARGE') return '支付的税金及附加';
    if (r.lvl1_code === 'EXP_OTHER' && r.lvl2_code === 'TAX') return '支付的各项税费';
    return r.lvl1_code;
  };

  lines.push({ section: 'operating_header', label: '一、经营活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of opInflows) {
    lines.push({ section: 'operating_in_detail', label: `  销售商品 - ${r.lvl2_code || ''}`, amount: toNum(r.total_in), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opInflows.length > 0) {
    lines.push({ section: 'operating_in', label: '  经营活动现金流入小计', amount: opInflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  for (const r of opOutflows) {
    lines.push({ section: 'operating_out_detail', label: `  ${labelForOpOutflow(r)}`, amount: -toNum(r.total_out), indent: 1, is_subtotal: false, is_highlight: false });
  }
  if (opOutflows.length > 0) {
    lines.push({ section: 'operating_out', label: '  经营活动现金流出小计', amount: -opOutflowTotal, indent: 1, is_subtotal: true, is_highlight: false });
  }
  // Non-cash adjustment: inventory change. Positive = inventory grew (use of cash).
  if (inventoryAdj !== 0) {
    lines.push({ section: 'operating_out_detail', label: '  存货变动', amount: inventoryAdj, indent: 1, is_subtotal: false, is_highlight: false });
  }
  const opNetWithInv = opNet + inventoryAdj;
  lines.push({ section: 'operating_net', label: '经营活动产生的现金流量净额', amount: opNetWithInv, indent: 0, is_subtotal: false, is_highlight: true });

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

  // Net increase (only from classified activities)
  const totalNet = opNetWithInv + invNet + finNet;
  lines.push({ section: 'total_net', label: '四、现金净增加额', amount: totalNet, indent: 0, is_subtotal: false, is_highlight: true });

  // Unclassified items display
  if (unclassified.length > 0) {
    const ucNet = unclassified.reduce((s, r) => s + toNum(r.net_amount), 0);
    lines.push({ section: 'unclassified', label: '五、未分类流水', amount: ucNet, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of unclassified) {
      lines.push({ section: 'unclassified_detail', label: `  ${r.lvl1_code}${r.lvl2_code ? '/' + r.lvl2_code : ''}`, amount: toNum(r.net_amount), indent: 1, is_subtotal: false, is_highlight: false });
    }
  }

  return lines;
}

// GET /api/financial/cashflow?brand=gelatomiiix&period=2026-01&span=month&store=all
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

    let dmSchema: string;
    try {
      dmSchema = await getDmSchemaSafe(brand);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'status' in err && (err as Record<string, unknown>).status === 400) {
        return NextResponse.json({ success: false, error: getErrorMessage(err) }, { status: 400 });
      }
      throw err;
    }

    const [result, invRes] = await Promise.all([
      getCashflowStatement(dmSchema, period, span, store),
      getInventoryChange(dmSchema, period, span, store),
    ]);
    // inventoryDelta is the change in inventory (closing - opening).
    // Cash flow effect: a positive delta (inventory grew) is a USE of cash → negative on CF.
    const inventoryDelta = invRes.closing_total - invRes.opening_total;
    const lines = buildCashflowLines(result as Parameters<typeof buildCashflowLines>[0], -inventoryDelta);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: unknown) {
    const errRecord = error as Record<string, unknown>;
    if (errRecord?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    console.error('Error in cashflow route:', error);
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) || 'Failed to load cashflow statement' }, { status });
  }
}
