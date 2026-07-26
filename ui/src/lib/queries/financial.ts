// Shared server-side query functions for the financial module.
// Used by both the RSC page (u/financial/page.tsx) and the API routes
// (api/financial/profit|cashflow|balance-sheet|overview). Pure DB access — no auth, no HTTP.
// Auth is the caller's responsibility (getSessionUser in API route / RSC).

import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getOdsSchema } from '@/lib/brand-server';
import { buildPeriodBoundaries, buildStoreCondition } from '@/lib/repositories/financial-utils';
import {
  getProfitStatement,
  getCogsTotal,
  getCashflowStatement,
  getInventoryChange,
  getFinancialOverview,
  getBeginningBalance,
  getActiveStoreCount,
  getKpiRate,
  getOperatingExpenses,
} from '@/lib/repositories/financial-repository';

const PG_ERR_NO_VIEW = '42P01';

// ── Types ──

export interface FinancialStatementLine {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

export interface FinancialStatementResult {
  lines: FinancialStatementLine[];
  note?: string;
}

export interface FinancialOverviewResult {
  revenue: number;
  grossMarginRate: number | null;
  netProfitRate: number;
  operatingCashflow: number;
  cashBalance: number;
  cashRunway: number | null;
  storeCount: number;
  revenuePerStore: number;
  qimaiNetRevenue: number | null;
  qimaiGrossRevenue: number | null;
  grossMarginRateQimaiNet: number | null;
  grossMarginRateQimaiGross: number | null;
  ignoreCount: number;
  beginningBalance: number | null;
  expenses: number;
  vsPrevPeriod: {
    revenue: number;
    grossMarginRate: number;
    netProfitRate: number;
    operatingCashflow: number;
  };
}

export interface FinancialStoreRow {
  code: string;
  name: string;
}

// ── Helpers ──

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

// ── Line builders (extracted from API routes) ──

interface ProfitRow {
  section: string;
  lvl1_code: string;
  lvl1_name: string;
  lvl2_code: string;
  lvl2_name: string;
  amount: string;
}

function buildProfitLines(
  raw: ProfitRow[],
  cogsTotal: number | null = null,
): FinancialStatementLine[] {
  const lines: FinancialStatementLine[] = [];

  const revenue = raw.filter(r => r.section === 'revenue' && r.lvl1_code === 'REV_BIZ');
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
  const expOther = raw.filter(r => r.lvl1_code === 'EXP_OTHER' && r.lvl2_code !== 'BONUS');
  const otherExpense = [...hr, ...rentUtil, ...mkt, ...admin, ...build, ...expOther];

  const sumAmount = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);
  const totalSigned = (items: typeof raw) => items.reduce((s, r) => s + Number(r.amount), 0);

  const revenueAmt = sumAmount(revenue);
  const otherIncomeAmt = sumAmount(otherIncome);
  const materialSigned = totalSigned(material);
  const costSigned = cogsTotal != null ? -Math.abs(cogsTotal) : materialSigned;
  const taxSurchargeSigned = totalSigned(taxSurcharge);
  const expenseSigned = totalSigned([...otherExpense, ...shipping]);
  const costDisplay = Math.abs(costSigned);
  const taxSurchargeDisplay = Math.abs(taxSurchargeSigned);
  const expenseDisplay = Math.abs(expenseSigned);

  let seq = 0;
  const nextNum = () => { seq++; return seq; };
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
  if (cogsTotal != null) {
    lines.push({ section: 'cost_note', label: '  (口径: 库存 COGS = 期初+采购−期末)', amount: 0, indent: 1, is_subtotal: false, is_highlight: false });
  } else {
    lines.push({ section: 'cost_note', label: '  (口径: 银行物料采购近似,无库存数据)', amount: 0, indent: 1, is_subtotal: false, is_highlight: false });
  }

  // — Section 3: 税金及附加 —
  if (taxSurcharge.length > 0) {
    const sec3 = `${roman(nextNum())}、税金及附加`;
    lines.push({ section: 'tax_surcharge', label: sec3, amount: taxSurchargeDisplay, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of taxSurcharge) {
      lines.push({ section: 'tax_surcharge_detail', label: `  ${r.lvl2_name}`, amount: Math.abs(Number(r.amount)), indent: 1, is_subtotal: false, is_highlight: false });
    }
    lines.push({ section: 'tax_surcharge', label: '税金及附加合计', amount: taxSurchargeDisplay, indent: 0, is_subtotal: true, is_highlight: false });
  }

  // — Gross profit (毛利) —
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

  // — 营业利润 —
  const operatingProfit = grossProfit + taxSurchargeSigned + expenseSigned + otherIncomeAmt;
  const secOP = `${roman(nextNum())}、营业利润`;
  lines.push({ section: 'operating_profit', label: secOP, amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

  // — 净利润 —
  const netProfitLabel = operatingProfit >= 0 ? '净利润（不含分红）' : '净亏损（不含分红）';
  const secNP = `${roman(nextNum())}、${netProfitLabel}`;
  lines.push({ section: 'net_profit', label: secNP, amount: operatingProfit, indent: 0, is_subtotal: false, is_highlight: true });

  return lines;
}

interface CashflowRow {
  activity: string;
  lvl1_code: string;
  lvl2_code: string;
  total_in: string;
  total_out: string;
  net_amount: string;
}

function buildCashflowLines(raw: CashflowRow[], inventoryAdj: number = 0): FinancialStatementLine[] {
  const lines: FinancialStatementLine[] = [];
  const operating = raw.filter(r => r.activity === 'operating');
  const investing = raw.filter(r => r.activity === 'investing');
  const financing = raw.filter(r => r.activity === 'financing');
  const unclassified = raw.filter(r => r.activity === 'unclassified' || r.activity === null);

  const toNum = (v: string) => Number(v);

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
  if (inventoryAdj !== 0) {
    lines.push({ section: 'operating_out_detail', label: '  存货变动', amount: inventoryAdj, indent: 1, is_subtotal: false, is_highlight: false });
  }
  const opNetWithInv = opNet + inventoryAdj;
  lines.push({ section: 'operating_net', label: '经营活动产生的现金流量净额', amount: opNetWithInv, indent: 0, is_subtotal: false, is_highlight: true });

  const invNet = investing.reduce((s, r) => s + toNum(r.net_amount), 0);
  lines.push({ section: 'investing_header', label: '二、投资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of investing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'investing_detail', label: `  ${r.lvl1_code === 'BUILD' ? '购建固定资产支付的现金' : r.lvl1_code + '/' + (r.lvl2_code || '')}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'investing_net', label: '投资活动产生的现金流量净额', amount: invNet, indent: 0, is_subtotal: false, is_highlight: true });

  const finNet = financing.reduce((s, r) => s + toNum(r.net_amount), 0);
  lines.push({ section: 'financing_header', label: '三、筹资活动产生的现金流量', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  for (const r of financing) {
    const amt = toNum(r.net_amount);
    lines.push({ section: 'financing_detail', label: `  ${r.lvl2_code === 'LOAN_IN' ? '取得借款收到的现金' : r.lvl2_code === 'BORROW_IN' ? '收到借款' : r.lvl2_code === 'REPAY' ? '偿还债务支付的现金' : r.lvl2_code || r.lvl1_code}`, amount: amt, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'financing_net', label: '筹资活动产生的现金流量净额', amount: finNet, indent: 0, is_subtotal: false, is_highlight: true });

  const totalNet = opNetWithInv + invNet + finNet;
  lines.push({ section: 'total_net', label: '四、现金净增加额', amount: totalNet, indent: 0, is_subtotal: false, is_highlight: true });

  if (unclassified.length > 0) {
    const ucNet = unclassified.reduce((s, r) => s + toNum(r.net_amount), 0);
    lines.push({ section: 'unclassified', label: '五、未分类流水', amount: ucNet, indent: 0, is_subtotal: false, is_highlight: false });
    for (const r of unclassified) {
      lines.push({ section: 'unclassified_detail', label: `  ${r.lvl1_code}${r.lvl2_code ? '/' + r.lvl2_code : ''}`, amount: toNum(r.net_amount), indent: 1, is_subtotal: false, is_highlight: false });
    }
  }

  return lines;
}

interface BalanceSheetRow {
  month: string;
  store_code: string;
  cash_balance: string;
  loan_balance: string;
  capital_balance: string;
  retained_earnings: string;
  inventory_amt: number;
}

function buildBalanceLines(raw: BalanceSheetRow[]): FinancialStatementLine[] {
  if (raw.length === 0) return [];

  const r = raw[raw.length - 1];
  const cash = Number(r.cash_balance);
  const loans = Number(r.loan_balance);
  const capital = Number(r.capital_balance);
  const retained = Number(r.retained_earnings);
  const inventory = r.inventory_amt || 0;
  const totalAssets = cash + inventory;
  const totalLiabilities = loans;
  const totalEquity = capital + retained;
  const lines: FinancialStatementLine[] = [];

  lines.push({ section: 'asset_header', label: '资产', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'asset_detail', label: '  货币资金', amount: cash, indent: 1, is_subtotal: false, is_highlight: false });
  if (inventory > 0) {
    lines.push({ section: 'asset_detail', label: '  存货', amount: inventory, indent: 1, is_subtotal: false, is_highlight: false });
  }
  lines.push({ section: 'asset_total', label: '资产总计', amount: totalAssets, indent: 0, is_subtotal: true, is_highlight: true });

  lines.push({ section: 'liability_header', label: '负债', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_detail', label: '  借款', amount: loans, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'liability_total', label: '负债总计', amount: totalLiabilities, indent: 0, is_subtotal: true, is_highlight: true });

  lines.push({ section: 'equity_header', label: '所有者权益', amount: 0, indent: 0, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  实收资本', amount: capital, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_detail', label: '  未分配利润', amount: retained, indent: 1, is_subtotal: false, is_highlight: false });
  lines.push({ section: 'equity_total', label: '所有者权益总计', amount: totalEquity, indent: 0, is_subtotal: true, is_highlight: true });

  const liabEquityTotal = totalLiabilities + totalEquity;
  const balanceDiff = totalAssets - liabEquityTotal;
  lines.push({ section: 'total', label: '负债和所有者权益总计', amount: liabEquityTotal, indent: 0, is_subtotal: false, is_highlight: true });

  if (Math.abs(balanceDiff) > 0.01) {
    lines.push({ section: 'difference', label: '差额（待分类流水）', amount: balanceDiff, indent: 0, is_subtotal: false, is_highlight: false });
  }

  return lines;
}

// ── Query functions (public API) ──

/** Fetch enabled stores for a brand. */
export async function getFinancialOffers(brand: string): Promise<FinancialStoreRow[]> {
  const res = await pool.query(
    `SELECT store_code, store_name
     FROM ops.stores
     WHERE brand_code = $1 AND enabled = true
     ORDER BY sort_order NULLS LAST, store_code`,
    [brand]
  );
  return res.rows.map((r: { store_code: string; store_name: string }) => ({
    code: r.store_code,
    name: r.store_name,
  }));
}

/** Fetch profit statement data. */
export async function getProfitStatementData(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<FinancialStatementResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { lines: [] };

  // Validate span
  if (!['month', 'quarter', 'year'].includes(span)) return { lines: [] };

  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return { lines: [] };

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { lines: [] };
  }

  try {
    const [result, cogsTotal] = await Promise.all([
      getProfitStatement(dmSchema, period, span, store),
      getCogsTotal(dmSchema, period, span, store),
    ]);
    const lines = buildProfitLines(result as ProfitRow[], cogsTotal);
    return { lines };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { lines: [], note: 'view not ready' };
    throw e;
  }
}

/** Fetch cashflow statement data. */
export async function getCashflowStatementData(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<FinancialStatementResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { lines: [] };

  if (!['month', 'quarter', 'year'].includes(span)) return { lines: [] };

  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return { lines: [] };

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { lines: [] };
  }

  try {
    const [result, invRes] = await Promise.all([
      getCashflowStatement(dmSchema, period, span, store),
      getInventoryChange(dmSchema, period, span, store),
    ]);
    const inventoryDelta = invRes.closing_total - invRes.opening_total;
    const lines = buildCashflowLines(result as CashflowRow[], -inventoryDelta);
    return { lines };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { lines: [], note: 'view not ready' };
    throw e;
  }
}

/** Fetch balance sheet data. */
export async function getBalanceSheetData(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<FinancialStatementResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) return { lines: [] };

  if (!['month', 'quarter', 'year'].includes(span)) return { lines: [] };

  const boundaries = buildPeriodBoundaries(period, span);
  if (!boundaries) return { lines: [] };

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return { lines: [] };
  }

  try {
    const [startDate, endDate] = [boundaries.start, boundaries.end];
    const viewName = `${dmSchema}.v_balance_sheet`;
    const profitView = `${dmSchema}.v_profit_statement`;

    // Balance sheet is a snapshot at end of period — use the last day
    const lastDay = new Date(endDate);
    lastDay.setDate(lastDay.getDate() - 1);
    const targetDate = lastDay.toISOString().split('T')[0];
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

    const inventoryParams: (string | number)[] = [targetMonth];
    let inventoryStoreClause = '';
    if (store !== 'all') {
      inventoryStoreClause = 'AND store_code = $2';
      inventoryParams.push(store);
    }
    const inventoryQuery = `
      SELECT store_code, closing_amt
      FROM ${dmSchema}.v_inventory_turnover
      WHERE period = to_char($1::date, 'YYYY-MM') ${inventoryStoreClause}
    `;

    const [balanceRes, profitRes, inventoryRes] = await Promise.all([
      pool.query(balanceQuery, params),
      pool.query(profitQuery, profitParams),
      pool.query(inventoryQuery, inventoryParams).catch(() => ({ rows: [] as { store_code: string; closing_amt: string | null }[] })),
    ]);

    const profitMap = new Map(profitRes.rows.map(r => [r.store_code, Number(r.retained_earnings)]));
    const inventoryMap = new Map(
      inventoryRes.rows.map(r => [r.store_code, r.closing_amt != null ? Number(r.closing_amt) : 0])
    );
    const merged = balanceRes.rows.map(r => ({
      ...r,
      retained_earnings: profitMap.get(r.store_code) || 0,
      inventory_amt: inventoryMap.get(r.store_code) || 0,
    }));

    const lines = buildBalanceLines(merged as BalanceSheetRow[]);
    return { lines };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) return { lines: [], note: 'view not ready' };
    throw e;
  }
}

/** Fetch financial overview data (for the OverviewPanel). */
export async function getFinancialOverviewData(
  brandRaw: string,
  period: string,
  span: string,
  store: string,
): Promise<FinancialOverviewResult> {
  const brand = normalizeBrand(brandRaw);
  if (!brand) {
    return {
      revenue: 0, grossMarginRate: null, netProfitRate: 0,
      operatingCashflow: 0, cashBalance: 0, cashRunway: null,
      storeCount: 0, revenuePerStore: 0,
      qimaiNetRevenue: null, qimaiGrossRevenue: null,
      grossMarginRateQimaiNet: null, grossMarginRateQimaiGross: null,
      ignoreCount: 0, beginningBalance: null, expenses: 0,
      vsPrevPeriod: { revenue: 0, grossMarginRate: 0, netProfitRate: 0, operatingCashflow: 0 },
    };
  }

  if (!['month', 'quarter', 'year'].includes(span)) {
    return {
      revenue: 0, grossMarginRate: null, netProfitRate: 0,
      operatingCashflow: 0, cashBalance: 0, cashRunway: null,
      storeCount: 0, revenuePerStore: 0,
      qimaiNetRevenue: null, qimaiGrossRevenue: null,
      grossMarginRateQimaiNet: null, grossMarginRateQimaiGross: null,
      ignoreCount: 0, beginningBalance: null, expenses: 0,
      vsPrevPeriod: { revenue: 0, grossMarginRate: 0, netProfitRate: 0, operatingCashflow: 0 },
    };
  }

  let dmSchema: string;
  try {
    dmSchema = await getDmSchemaSafe(brand);
  } catch {
    return {
      revenue: 0, grossMarginRate: null, netProfitRate: 0,
      operatingCashflow: 0, cashBalance: 0, cashRunway: null,
      storeCount: 0, revenuePerStore: 0,
      qimaiNetRevenue: null, qimaiGrossRevenue: null,
      grossMarginRateQimaiNet: null, grossMarginRateQimaiGross: null,
      ignoreCount: 0, beginningBalance: null, expenses: 0,
      vsPrevPeriod: { revenue: 0, grossMarginRate: 0, netProfitRate: 0, operatingCashflow: 0 },
    };
  }
  const odsSchema = getOdsSchema(brand);

  try {
    const isAll = period === 'all';

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

    let grossMarginRate: number | null;
    const gmFromView = gmRate;
    if (gmFromView != null) {
      grossMarginRate = gmFromView;
    } else {
      grossMarginRate = revenue > 0 && materialCost < 0 ? (revenue + materialCost) / revenue : null;
    }
    const netProfitRate = npRate ?? 0;

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
    const beginningBalance = isAll ? null : Number(beginBalanceRes[0]?.cash_balance || 0);

    // Ignore records count
    let ignoreCount = 0;
    try {
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

    // Previous period comparison
    const prevPeriodStr = isAll ? '' : getPrevPeriod(period, span);
    let vsRevenue = 0, vsGm = 0, vsNp = 0, vsOcf = 0;

    if (!isAll && prevPeriodStr) {
      try {
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
        const prevGmRateVal = prevGmRate != null ? prevGmRate
          : (prevRev > 0 && prevMat < 0 ? (prevRev + prevMat) / prevRev : null);
        vsGm = grossMarginRate != null && prevGmRateVal != null && revenue > 0 ? grossMarginRate - prevGmRateVal : 0;
        vsNp = revenue > 0 ? netProfitRate - (prevNpRate ?? 0) : 0;
        vsOcf = prevOcf !== 0 ? (operatingCashflow - prevOcf) / Math.abs(prevOcf) : 0;
      } catch { /* prev period not available */ }
    }

    return {
      revenue,
      grossMarginRate,
      netProfitRate,
      qimaiNetRevenue: qimaiNet,
      qimaiGrossRevenue: qimaiGross,
      grossMarginRateQimaiNet,
      grossMarginRateQimaiGross,
      operatingCashflow,
      cashBalance,
      cashRunway,
      storeCount,
      revenuePerStore,
      ignoreCount,
      beginningBalance,
      expenses,
      vsPrevPeriod: {
        revenue: vsRevenue,
        grossMarginRate: vsGm,
        netProfitRate: vsNp,
        operatingCashflow: vsOcf,
      },
    };
  } catch (e: any) {
    if (e?.code === PG_ERR_NO_VIEW) {
      return {
        revenue: 0, grossMarginRate: null, netProfitRate: 0,
        operatingCashflow: 0, cashBalance: 0, cashRunway: null,
        storeCount: 0, revenuePerStore: 0,
        qimaiNetRevenue: null, qimaiGrossRevenue: null,
        grossMarginRateQimaiNet: null, grossMarginRateQimaiGross: null,
        ignoreCount: 0, beginningBalance: null, expenses: 0,
        vsPrevPeriod: { revenue: 0, grossMarginRate: 0, netProfitRate: 0, operatingCashflow: 0 },
      };
    }
    throw e;
  }
}
