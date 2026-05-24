import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

function buildProfitLines(raw: { section: string; lvl1_code: string; lvl1_name: string; lvl2_code: string; lvl2_name: string; amount: string }[]): LineItem[] {
  const lines: LineItem[] = [];

  const revenue = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_BIZ');
  // 其他收益只包含经营性收入（利息、退款、退税），不含借款/贷款/注资
  const otherIncome = raw.filter(r =>
    r.section === 'revenue' && r.lvl1_code === 'REV_OTHER'
    && !['BORROW_IN', 'LOAN_IN', 'INVEST_IN'].includes(r.lvl2_code)
  );
  const material = raw.filter(r => r.lvl1_code === 'MATERIAL');
  const shipping = raw.filter(r => r.lvl1_code === 'SHIP');
  const hr = raw.filter(r => r.lvl1_code === 'HR');
  const rentUtil = raw.filter(r => r.lvl1_code === 'RENT_UTIL');
  const mkt = raw.filter(r => r.lvl1_code === 'MKT');
  const admin = raw.filter(r => r.lvl1_code === 'ADMIN');
  const build = raw.filter(r => r.lvl1_code === 'BUILD');
  const taxSurcharge = raw.filter(r => r.lvl1_code === 'TAX_SURCHARGE');
  const expOther = raw.filter(r => r.lvl1_code === 'EXP_OTHER');
  const otherExpense = [...hr, ...rentUtil, ...mkt, ...admin, ...build, ...expOther];

  const sumAmount = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);
  const totalSigned = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);

  const revenueAmt = sumAmount(revenue);
  const otherIncomeAmt = sumAmount(otherIncome);
  const costSigned = totalSigned(material);                    // negative
  const taxSurchargeSigned = totalSigned(taxSurcharge);       // negative
  const expenseSigned = totalSigned([...otherExpense, ...shipping]);  // negative
  const costDisplay = Math.abs(costSigned);
  const taxSurchargeDisplay = Math.abs(taxSurchargeSigned);
  const expenseDisplay = Math.abs(expenseSigned);

  // Dynamic section numbering
  let seq = 0;
  const nextNum = () => {
    seq++;
    return seq;
  };

  // Helper: roman numerals
  const roman = (n: number) => '一二三四五六七八九十'[n - 1] || String(n);

  // — Section 1: 营业收入 —
  const sec1 = `一、营业收入`;
  lines.push({ section: 'revenue', label: sec1, amount: revenueAmt, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of revenue) {
    lines.push({ section: 'revenue_detail', label: `  ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'revenue', label: '营业收入合计', amount: revenueAmt, indent: 0, is_subtotal: true, is_highlight: false });
  nextNum();

  // — Section 2: 营业成本 —
  const sec2 = `${roman(nextNum())}、营业成本`;
  lines.push({ section: 'cost', label: sec2, amount: costDisplay, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of material) {
    lines.push({ section: 'cost_detail', label: `  材料采购 - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'cost', label: '营业成本合计', amount: costDisplay, indent: 0, is_subtotal: true, is_highlight: false });

  // — Section 3: 税金及附加 (always shown if has data, per accounting standards) —
  if (taxSurcharge.length > 0) {
    const sec3 = `${roman(nextNum())}、税金及附加`;
    lines.push({ section: 'tax_surcharge', label: sec3, amount: taxSurchargeDisplay, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of taxSurcharge) {
      lines.push({ section: 'tax_surcharge_detail', label: `  ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
    }
    lines.push({ section: 'tax_surcharge', label: '税金及附加合计', amount: taxSurchargeDisplay, indent: 0, is_subtotal: true, is_highlight: false });
  }

  // — Gross profit (毛利) = revenue + cost(negative) —
  const grossProfit = revenueAmt + costSigned;
  const secGP = `${roman(nextNum())}、毛利`;
  lines.push({ section: 'gross_profit', label: secGP, amount: grossProfit, indent: 0, is_subtotal: false, is_highlight: true });

  // — 其他收益 (conditional) —
  const otherIncomeDisplay = otherIncome.length > 0 ? Math.abs(otherIncomeAmt) : 0;
  if (otherIncome.length > 0) {
    const secOI = `${roman(nextNum())}、其他收益`;
    lines.push({ section: 'other_income', label: secOI, amount: otherIncomeDisplay, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of otherIncome) {
      lines.push({ section: 'other_income_detail', label: `  ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
    }
    lines.push({ section: 'other_income', label: '其他收益合计', amount: otherIncomeDisplay, indent: 0, is_subtotal: true, is_highlight: false });
  }

  // — 期间费用 —
  const secExp = `${roman(nextNum())}、期间费用`;
  lines.push({ section: 'expense', label: secExp, amount: expenseDisplay, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of otherExpense) {
    lines.push({ section: 'expense_detail', label: `  ${r.lvl1_name} - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  for (const r of shipping) {
    lines.push({ section: 'expense_detail', label: `  运费 - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'expense', label: '期间费用合计', amount: expenseDisplay, indent: 0, is_subtotal: true, is_highlight: false });

  // — 营业利润 = 毛利 + 税金及附加(negative) + 期间费用(negative) + 其他收益 —
  const operatingProfit = grossProfit + taxSurchargeSigned + expenseSigned + otherIncomeAmt;
  const secOP = `${roman(nextNum())}、营业利润`;
  lines.push({ section: 'operating_profit', label: secOP, amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

  // — 净利润 —
  const netProfitLabel = operatingProfit >= 0 ? '净利润' : '净亏损';
  const secNP = `${roman(nextNum())}、${netProfitLabel}`;
  lines.push({ section: 'net_profit', label: secNP, amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

// GET /api/financial/profit?brand=gelatomiiix&period=2026-01&span=month&store=all
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

    // Validate span
    if (!['month', 'quarter', 'year'].includes(span)) {
      return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
    }

    // Validate period format
    const boundaries = parsePeriod(period, span);
    if (!boundaries) {
      return NextResponse.json({ success: false, error: 'Invalid period format' }, { status: 400 });
    }
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
    const viewName = `${dmSchema}.v_profit_statement`;

    // Use parameterized query for store filter to prevent SQL injection
    const params: (string | number)[] = [startDate, endDate];
    let storeClause = '';
    if (store !== 'all') {
      storeClause = `AND store_code = $3`;
      params.push(store);
    }

    const query = `
      SELECT section, lvl1_code, lvl1_name, lvl2_code, lvl2_name,
             sum(amount) as amount
      FROM ${viewName}
      WHERE month >= $1::date AND month < $2::date ${storeClause}
      GROUP BY section, lvl1_code, lvl1_name, lvl2_code, lvl2_name
      ORDER BY min(sort_order), lvl1_code, lvl2_code
    `;

    const result = await pool.query(query, params);
    const lines = buildProfitLines(result.rows);

    return NextResponse.json({
      success: true,
      data: { brand, period, span, store, lines }
    });

  } catch (error: unknown) {
    const errRecord = error as Record<string, unknown>;
    if (errRecord?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    console.error('Error in profit route:', error);
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) || 'Failed to load profit statement' }, { status });
  }
}
