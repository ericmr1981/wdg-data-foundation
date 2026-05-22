import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';

interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

function buildProfitLines(raw: { section: string; lvl1_code: string; lvl1_name: string; lvl2_name: string; amount: string }[]): LineItem[] {
  const lines: LineItem[] = [];

  const revenue = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_BIZ');
  const otherIncome = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_OTHER');
  const material = raw.filter(r => r.lvl1_code === 'MATERIAL');
  const shipping = raw.filter(r => r.lvl1_code === 'SHIP');
  const hr = raw.filter(r => r.lvl1_code === 'HR');
  const rentUtil = raw.filter(r => r.lvl1_code === 'RENT_UTIL');
  const mkt = raw.filter(r => r.lvl1_code === 'MKT');
  const admin = raw.filter(r => r.lvl1_code === 'ADMIN');
  const build = raw.filter(r => r.lvl1_code === 'BUILD');
  const expOther = raw.filter(r => r.lvl1_code === 'EXP_OTHER');
  const otherExpense = [...hr, ...rentUtil, ...mkt, ...admin, ...build, ...expOther];

  const sumAmount = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);
  const totalSigned = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);

  const revenueAmt = sumAmount(revenue);
  const otherIncomeAmt = sumAmount(otherIncome);
  const costSigned = totalSigned(material);           // negative
  const expenseSigned = totalSigned([...otherExpense, ...shipping]);  // negative
  const costDisplay = Math.abs(costSigned);
  const expenseDisplay = Math.abs(expenseSigned);

  lines.push({ section: 'revenue', label: '一、营业收入', amount: revenueAmt, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of revenue) {
    lines.push({ section: 'revenue_detail', label: `  ${r.lvl2_name}`, amount: Number(r.amount), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'revenue', label: '营业收入合计', amount: revenueAmt, indent: 0, is_subtotal: true, is_highlight: false });

  lines.push({ section: 'cost', label: '二、营业成本', amount: costDisplay, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of material) {
    lines.push({ section: 'cost_detail', label: `  材料采购 - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'cost', label: '营业成本合计', amount: costDisplay, indent: 0, is_subtotal: true, is_highlight: false });

  // amount is already signed: revenue=positive, cost/expense=negative → use addition
  const grossProfit = revenueAmt + costSigned;
  lines.push({ section: 'gross_profit', label: '三、毛利', amount: grossProfit, indent: 0, is_subtotal: false, is_highlight: true });

  const otherIncomeDisplay = otherIncome.length > 0 ? Math.abs(otherIncomeAmt) : 0;
  if (otherIncome.length > 0) {
    lines.push({ section: 'other_income', label: '四、其他收益', amount: otherIncomeDisplay, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of otherIncome) {
      lines.push({ section: 'other_income_detail', label: `  ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
    }
    lines.push({ section: 'other_income', label: '其他收益合计', amount: otherIncomeDisplay, indent: 0, is_subtotal: true, is_highlight: false });
  }

  lines.push({ section: 'expense', label: '五、期间费用', amount: expenseDisplay, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of otherExpense) {
    lines.push({ section: 'expense_detail', label: `  ${r.lvl1_name} - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  for (const r of shipping) {
    lines.push({ section: 'expense_detail', label: `  运费 - ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'expense', label: '期间费用合计', amount: expenseDisplay, indent: 0, is_subtotal: true, is_highlight: false });

  const operatingProfit = grossProfit + expenseSigned + otherIncomeAmt;
  lines.push({ section: 'operating_profit', label: '六、营业利润', amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

  const netProfitLabel = operatingProfit >= 0 ? '净利润' : '净亏损';
  lines.push({ section: 'net_profit', label: `七、${netProfitLabel}`, amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

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
    } catch (err: any) {
      if (err?.status === 400) {
        return NextResponse.json({ success: false, error: err.message }, { status: 400 });
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

  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: { brand: '', period, span, store: '', lines: [] }, note: 'view not ready' });
    }
    console.error('Error in profit route:', error);
    const status = error?.status || 500;
    return NextResponse.json({ success: false, error: error.message || 'Failed to load profit statement' }, { status });
  }
}
