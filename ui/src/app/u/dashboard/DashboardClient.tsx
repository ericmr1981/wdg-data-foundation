'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/lib/brand-context';

// ── Types ────────────────────────────────────────────────────────────────────

type SpanId = 'month' | 'quarter' | 'year';

interface Store {
  code: string;
  name: string;
}

interface BrandOption {
  code: string;
  name: string;
}

interface OverviewData {
  revenue: number;
  expenses: number;
  grossMarginRate: number | null;
  netProfitRate: number | null;
  grossMarginRateQimaiNet: number | null;
  grossMarginRateQimaiGross: number | null;
  qimaiNetRevenue: number | null;
  qimaiGrossRevenue: number | null;
  operatingCashflow: number;
  cashBalance: number;
  cashRunway: number | null;
  storeCount: number;
  revenuePerStore: number;
  ignoreCount: number;
  beginningBalance: number;
  vsPrevPeriod: {
    revenue: number;
    grossMarginRate: number;
    netProfitRate: number;
    operatingCashflow: number;
  };
}

interface ExpenseItem {
  lvl1_code: string;
  lvl1_name: string;
  lvl2_code: string;
  lvl2_name: string;
  amount: number;
}

interface MonthlyKpi {
  month: string;
  revenue: number;
  gross_margin_rate: number;
  net_profit_rate: number | null;
  operating_cashflow: number;
  expenses: number;
}

interface TrendData {
  monthly: MonthlyKpi[];
  current_month: { revenue: number; expenses: ExpenseItem[] } | null;
  prev_month: { revenue: number; expenses: ExpenseItem[] } | null;
}

interface QimaiRevenueData {
  bank_revenue: number;
  qimai_revenue: number | null;
}

interface DashboardClientProps {
  brand: string;
  span: SpanId;
  period: string;
  store: string;
  stores: Store[];
  brandOptions: BrandOption[];
  overview: OverviewData | null;
  overviewNote?: string;
  trend: TrendData | null;
  trendNote?: string;
  qimaiRevenue: QimaiRevenueData | null;
}

type TrendKey = 'revenue' | 'expenses' | 'gross_margin_rate' | 'net_profit_rate' | 'operating_cashflow';

// ── Constants ────────────────────────────────────────────────────────────────

const TREND_LABELS: Record<TrendKey, string> = {
  revenue: '营业收入',
  expenses: '营业支出',
  gross_margin_rate: '毛利率',
  net_profit_rate: '净利润率',
  operating_cashflow: '经营现金流',
};

const EXPENSE_COLORS: Record<string, string> = {
  MATERIAL: 'bg-orange-500',
  HR: 'bg-blue-500',
  RENT_UTIL: 'bg-purple-500',
  MKT: 'bg-pink-500',
  ADMIN: 'bg-teal-500',
  BUILD: 'bg-amber-500',
  SHIP: 'bg-indigo-500',
  TAX_SURCHARGE: 'bg-gray-500',
  EXP_OTHER: 'bg-red-400',
};

const CLICKABLE_KPIS: TrendKey[] = [
  'revenue',
  'expenses',
  'gross_margin_rate',
  'net_profit_rate',
  'operating_cashflow',
];

// ── Sub-components ───────────────────────────────────────────────────────────

function PeriodSelector({
  span,
  period,
  onSpanChange,
  onPeriodChange,
}: {
  span: SpanId;
  period: string;
  onSpanChange: (v: SpanId) => void;
  onPeriodChange: (v: string) => void;
}) {
  const options = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    if (span === 'month') {
      const arr: string[] = ['all'];
      for (let i = 0; i < 18; i++) {
        const d = new Date(y, m - i, 1);
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        arr.push(`${d.getFullYear()}-${mm}`);
      }
      return arr;
    }
    if (span === 'quarter') {
      const curQ = Math.floor(m / 3) + 1;
      const arr: string[] = ['all'];
      for (let i = 0; i < 9; i++) {
        const qOffset = i;
        const yearOff = Math.floor((curQ - 1 - qOffset) / 4);
        const qNum = ((curQ - 1 - qOffset) % 4 + 4) % 4 + 1;
        const qy = y - yearOff;
        arr.push(`${qy}-Q${qNum}`);
      }
      return arr;
    }
    const arr: string[] = ['all'];
    for (let i = 0; i < 4; i++) {
      arr.push(String(y - i));
    }
    return arr;
  }, [span]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select
        value={span}
        onChange={(e) => onSpanChange(e.target.value as SpanId)}
        className="border rounded px-2 py-1 text-sm bg-white"
      >
        <option value="month">月度</option>
        <option value="quarter">季度</option>
        <option value="year">年度</option>
      </select>
      <select
        value={period}
        onChange={(e) => onPeriodChange(e.target.value)}
        className="border rounded px-2 py-1 text-sm bg-white"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o === 'all' ? '全部' : o}
          </option>
        ))}
      </select>
    </div>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded h-2 overflow-hidden">
      <div
        className={`h-full rounded transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  prefix = '¥',
  vsPrev,
  isRate = false,
  invert = false,
  trendKey,
  active,
  onClick,
  noClick,
  subValue,
  subLabel,
}: {
  label: string;
  value: number | null;
  prefix?: string;
  vsPrev?: number;
  isRate?: boolean;
  invert?: boolean;
  trendKey?: TrendKey;
  active?: boolean;
  onClick?: () => void;
  noClick?: boolean;
  subValue?: number | null;
  subLabel?: string;
}) {
  const display =
    value == null
      ? '-'
      : isRate
        ? `${(value * 100).toFixed(1)}%`
        : `${prefix}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const subDisplay =
    subValue == null
      ? null
      : isRate
        ? `${(subValue * 100).toFixed(1)}%`
        : `${prefix}${subValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const vs = vsPrev !== undefined && vsPrev !== 0;
  const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;
  const nullTooltip =
    value == null && isRate
      ? '首期缺期初库存，毛利率/净利润率暂不显示。从有上月期末的月份开始展示。'
      : undefined;
  return (
    <div
      className={`bg-white border rounded-lg p-3 transition-all ${noClick ? '' : 'cursor-pointer'} ${active ? 'ring-2 ring-blue-400 shadow-md' : 'hover:shadow-sm'}`}
      onClick={!noClick && trendKey ? onClick : undefined}
      title={nullTooltip}
    >
      <div className="text-[11px] text-gray-500 mb-0.5 truncate">{label}</div>
      <div className="text-lg font-bold text-gray-900">{display}</div>
      {subDisplay && (
        <div className="text-[10px] text-gray-500 mt-0.5" title={subLabel}>
          {subLabel ? `${subLabel} ${subDisplay}` : subDisplay}
        </div>
      )}
      {vs && (
        <div
          className={`text-[11px] mt-0.5 ${good ? 'text-green-600' : 'text-red-600'}`}
        >
          {vsPrev >= 0 ? '↑' : '↓'} {Math.abs(vsPrev * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ── Tooltip bar chart ──────────────────────────────────────────────────────
function TrendChart({
  data,
  trendKey,
  format,
  period,
}: {
  data: MonthlyKpi[];
  trendKey: TrendKey;
  format?: (v: number) => string;
  period?: string;
}) {
  const [tooltip, setTooltip] = useState<{
    month: string;
    value: number | null;
    x: number;
    y: number;
  } | null>(null);
  const sorted = [...data].reverse();
  const numericValues = sorted
    .map((d) => d[trendKey])
    .filter((v): v is number => typeof v === 'number');
  const range =
    numericValues.length > 0
      ? Math.max(
          Math.max(...numericValues, 0),
          Math.abs(Math.min(...numericValues, 0)),
          1,
        )
      : 1;
  const halfH = 132;
  const fmt =
    format ||
    ((v: number) =>
      v.toLocaleString(undefined, { minimumFractionDigits: 2 }));

  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">
        {TREND_LABELS[trendKey]}趋势
        {period === 'all' ? '(全部历史)' : ''}
      </h3>
      <div className="relative" style={{ height: '300px' }}>
        <div
          className="absolute left-0 text-[9px] text-gray-400"
          style={{ top: '4px' }}
        >
          {fmt(range)}
        </div>
        <div
          className="absolute left-0 text-[9px] text-gray-400"
          style={{ bottom: '24px' }}
        >
          {fmt(-range)}
        </div>
        <div
          className="absolute left-6 right-2"
          style={{
            top: `${halfH + 12}px`,
            height: '1px',
            backgroundColor: '#9CA3AF',
          }}
        />
        <div
          className="absolute left-6 right-2 flex items-start gap-[3px]"
          style={{ top: '12px', height: '264px' }}
        >
          {sorted.map((d) => {
            const val = d[trendKey];
            if (val == null) {
              return (
                <div
                  key={d.month}
                  className="flex-1 flex flex-col items-center justify-center relative"
                  style={{ height: '100%' }}
                >
                  <div
                    className="text-[10px] text-gray-400"
                    style={{ marginTop: `${halfH - 6}px` }}
                  >
                    —
                  </div>
                  <div
                    className="absolute text-[9px] text-gray-400"
                    style={{ bottom: '-18px' }}
                  >
                    {d.month.slice(2)}
                  </div>
                </div>
              );
            }
            const isPos = val >= 0;
            const pct = range > 0 ? Math.abs(val) / range : 0;
            const barH = Math.max(1, pct * halfH);
            const barColor = isPos ? '#22C55E' : '#EF4444';
            return (
              <div
                key={d.month}
                className="flex-1 flex flex-col items-center relative"
                style={{ height: '100%' }}
              >
                {isPos ? (
                  <div
                    className="w-full cursor-pointer hover:opacity-80"
                    style={{
                      height: `${barH}px`,
                      backgroundColor: barColor,
                      opacity: 0.85,
                      marginTop: `${halfH - barH}px`,
                      borderTopLeftRadius: '2px',
                      borderTopRightRadius: '2px',
                    }}
                    onMouseEnter={(e) => {
                      const r = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setTooltip({
                        month: d.month,
                        value: val,
                        x: r.left + r.width / 2,
                        y: r.top,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ) : (
                  <div
                    className="w-full cursor-pointer hover:opacity-80"
                    style={{
                      height: `${barH}px`,
                      backgroundColor: barColor,
                      opacity: 0.85,
                      marginTop: `${halfH}px`,
                      borderBottomLeftRadius: '2px',
                      borderBottomRightRadius: '2px',
                    }}
                    onMouseEnter={(e) => {
                      const r = (
                        e.currentTarget as HTMLElement
                      ).getBoundingClientRect();
                      setTooltip({
                        month: d.month,
                        value: val,
                        x: r.left + r.width / 2,
                        y: r.top,
                      });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )}
                <div
                  className="absolute text-[9px] text-gray-400"
                  style={{ bottom: '-18px' }}
                >
                  {d.month.slice(2)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          {tooltip.month}: {tooltip.value == null ? '—' : fmt(tooltip.value)}
        </div>
      )}
    </div>
  );
}

// ── Expense breakdown ──────────────────────────────────────────────────────
function ExpenseBreakdown({ trend }: { trend: TrendData | null }) {
  const cur = trend?.current_month;
  const prev = trend?.prev_month;
  const expenses = cur?.expenses || [];
  const revenue = cur?.revenue || 1;
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);

  const prevMap = new Map<string, number>();
  for (const e of prev?.expenses || []) {
    prevMap.set(`${e.lvl1_code}:${e.lvl2_code}`, e.amount);
  }

  const groups = new Map<
    string,
    { lvl1_code: string; lvl1_name: string; items: typeof expenses }
  >();
  for (const e of expenses) {
    const key = e.lvl1_code;
    if (!groups.has(key))
      groups.set(key, { lvl1_code: key, lvl1_name: e.lvl1_name || key, items: [] });
    groups.get(key)!.items.push(e);
  }

  const sortedGroups = Array.from(groups.entries())
    .map(([code, g]) => ({
      ...g,
      total: g.items.reduce((s, i) => s + i.amount, 0),
    }))
    .sort((a, b) => b.total - a.total);

  const maxLvl2Amt = Math.max(...expenses.map((e) => e.amount), 1);

  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(
    new Set(sortedGroups.map((g) => g.lvl1_code)),
  );

  const toggle = (code: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">支出构成</h3>
      {sortedGroups.length === 0 ? (
        <div className="text-xs text-gray-400 text-center py-4">暂无数据</div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs text-gray-500 font-medium px-1">
            <span>科目</span>
            <span>金额</span>
            <span>占营收</span>
            <span>环比</span>
          </div>
          {sortedGroups.map((g) => {
            const isCollapsed = collapsedSet.has(g.lvl1_code);
            const sortedItems = [...g.items].sort((a, b) => b.amount - a.amount);
            return (
              <div key={g.lvl1_code}>
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs font-semibold items-center px-1 mb-1 text-gray-700 cursor-pointer hover:bg-gray-100 rounded py-0.5 select-none"
                  onClick={() => toggle(g.lvl1_code)}
                >
                  <span>{isCollapsed ? '▶' : '▼'} {g.lvl1_name}</span>
                  <span
                    className={`text-right px-1.5 py-0.5 rounded ${g.total > 0 ? 'bg-blue-50 text-blue-800' : ''}`}
                  >
                    ¥
                    {g.total.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </span>
                  <span
                    className={`text-right px-1.5 py-0.5 rounded ${g.total > 0 ? 'bg-purple-50 text-purple-800' : ''}`}
                  >
                    {revenue > 0
                      ? ((g.total / Math.abs(revenue)) * 100).toFixed(1)
                      : 0}
                    %
                  </span>
                  <span className="text-right text-gray-400">-</span>
                </div>
                {!isCollapsed &&
                  sortedItems.map((item) => {
                    const momAmt = prevMap.get(
                      `${item.lvl1_code}:${item.lvl2_code}`,
                    );
                    let momText: string;
                    let momColor: string;
                    if (momAmt === undefined) {
                      momText = '-';
                      momColor = 'bg-gray-100 text-gray-400';
                    } else if (momAmt === 0 && item.amount > 0) {
                      momText = '新增';
                      momColor = 'bg-orange-100 text-orange-700';
                    } else if (momAmt === 0) {
                      momText = '0%';
                      momColor = 'bg-gray-100 text-gray-500';
                    } else {
                      const pct = (item.amount - momAmt) / momAmt;
                      momText = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct * 100).toFixed(1)}%`;
                      momColor =
                        pct <= 0
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700';
                    }
                    const pctOfRev =
                      revenue > 0
                        ? (item.amount / Math.abs(revenue)) * 100
                        : 0;
                    const amtBg = item.amount > 0 ? 'bg-blue-50' : '';
                    const pctBg = pctOfRev > 0 ? 'bg-purple-50' : '';
                    return (
                      <div
                        key={`${item.lvl1_code}:${item.lvl2_code}`}
                        className="pl-4 mb-1"
                      >
                        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs items-center px-1 mb-0.5">
                          <span className="text-gray-500 truncate text-[11px]">
                            {item.lvl2_name || item.lvl2_code}
                          </span>
                          <span
                            className={`font-mono text-gray-700 text-right text-[11px] px-1.5 py-0.5 rounded ${amtBg}`}
                          >
                            ¥
                            {item.amount.toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                            })}
                          </span>
                          <span
                            className={`text-right w-14 text-[11px] px-1.5 py-0.5 rounded font-medium ${pctBg} ${pctOfRev > 0 ? 'text-purple-700' : 'text-gray-400'}`}
                          >
                            {pctOfRev.toFixed(1)}%
                          </span>
                          <span
                            className={`text-right w-[60px] text-[11px] px-1.5 py-0.5 rounded font-medium ${momColor}`}
                          >
                            {momText}
                          </span>
                        </div>
                        <MiniBar
                          pct={(item.amount / maxLvl2Amt) * 100}
                          color={
                            EXPENSE_COLORS[item.lvl1_code] || 'bg-gray-400'
                          }
                        />
                      </div>
                    );
                  })}
              </div>
            );
          })}
          <div className="border-t pt-2 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs font-semibold px-1">
            <span className="text-gray-700">合计</span>
            <span className="text-gray-900 text-right">
              ¥
              {totalExp.toLocaleString(undefined, { minimumFractionDigits: 0 })}
            </span>
            <span className="text-gray-700 text-right">
              {revenue > 0
                ? ((totalExp / Math.abs(revenue)) * 100).toFixed(1)
                : 0}
              %
            </span>
            <span className="text-right text-gray-400">-</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DataHealth({ stores }: { stores: Store[] }) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">数据健康</h3>
      {stores.length === 0 ? (
        <div className="text-xs text-gray-400">暂无数据</div>
      ) : (
        <div className="space-y-2 text-xs">
          {stores.map((s) => (
            <div
              key={s.code}
              className="flex justify-between items-center border-b pb-1 last:border-0"
            >
              <span className="font-medium text-gray-700">{s.name}</span>
              <span className="text-gray-500">暂无数据</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickLinks({
  span,
  period,
  store,
  brand,
}: {
  span: string;
  period: string;
  store: string;
  brand: string;
}) {
  const params = new URLSearchParams({ span, period, store, brand }).toString();
  const links = [
    {
      href: `/u/financial?${params}`,
      label: '财务报表',
      desc: '利润表 / 现金流量表 / 资产负债表',
    },
    { href: `/u/payment?${params}`, label: '付款分析', desc: '按科目 / 往来方查看支出' },
    {
      href: `/u/income?${params}`,
      label: '收入分析',
      desc: '收入趋势 / 银行入账率',
    },
    {
      href: `/u/sales?${params}`,
      label: '销售报表',
      desc: '各门店销售数据汇总',
    },
    {
      href: `/u/store-report?${params}`,
      label: '门店月报',
      desc: '当月快照 + 12月趋势 + Excel',
    },
  ];
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">快捷入口</h3>
      <div className="grid grid-cols-3 gap-2">
        {links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            className="block p-3 border rounded hover:bg-gray-50 transition-colors"
          >
            <div className="text-sm font-medium text-blue-600">{l.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main Client Component ──────────────────────────────────────────────────

export function DashboardClient({
  brand,
  span,
  period,
  store,
  stores,
  brandOptions,
  overview,
  overviewNote,
  trend,
  trendNote,
  qimaiRevenue,
}: DashboardClientProps) {
  const router = useRouter();
  const { setBrand: setCtxBrand } = useBrand();
  const [activeTrend, setActiveTrend] = useState<TrendKey>('revenue');

  // Sync brand cookie with URL-derived brand.
  useEffect(() => {
    setCtxBrand(brand);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  function navigate(
    next: Partial<{
      brand: string;
      span: SpanId;
      period: string;
      store: string;
    }>,
  ) {
    const params = new URLSearchParams();
    const b = next.brand ?? brand;
    const s = next.span ?? span;
    const p = next.period ?? period;
    const st = next.store ?? store;
    params.set('brand', b);
    params.set('span', s);
    params.set('period', p);
    params.set('store', st);
    router.push(`/u/dashboard?${params.toString()}`);
  }

  // Bank entry rate
  const bankRevenue = qimaiRevenue?.bank_revenue ?? null;
  const qimaiRev = qimaiRevenue?.qimai_revenue ?? null;
  const showEntryRate = bankRevenue !== null && qimaiRev !== null;
  const entryRate =
    showEntryRate && qimaiRev! > 0
      ? Math.min(bankRevenue! / qimaiRev!, 1)
      : null;

  const note = overviewNote ?? trendNote;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">经营看板</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodSelector
            span={span}
            period={period}
            onSpanChange={(v) => navigate({ span: v, period: 'all' })}
            onPeriodChange={(p) => navigate({ period: p })}
          />
          <select
            value={store}
            onChange={(e) => navigate({ store: e.target.value })}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">全部门店</option>
            {stores.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            value={brand}
            onChange={(e) =>
              navigate({ brand: e.target.value, store: 'all' })
            }
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            {brandOptions.map((b) => (
              <option key={b.code} value={b.code}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {note && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 text-sm text-yellow-700">
          {note === 'view not ready'
            ? '数据视图尚未生成，请稍后再试。'
            : note}
        </div>
      )}

      {!overview ? (
        <div className="text-center py-12 text-gray-400">
          暂无数据
          {note === 'view not ready' ? '（视图未就绪）' : ''}
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div
            data-testid="kpi-grid"
            className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-3"
          >
            {CLICKABLE_KPIS.map((k) => {
              const isGrossCard = k === 'gross_margin_rate';
              const primaryValue = isGrossCard
                ? (overview.grossMarginRateQimaiNet ?? overview.grossMarginRate)
                : k === 'revenue'
                  ? overview.revenue
                  : k === 'expenses'
                    ? overview.expenses
                    : k === 'net_profit_rate'
                      ? overview.netProfitRate
                      : overview.operatingCashflow;
              const subValue = isGrossCard
                ? overview.grossMarginRateQimaiGross
                : null;
              const subLabel = isGrossCard ? '营业额' : undefined;
              return (
                <KpiCard
                  key={k}
                  label={TREND_LABELS[k]}
                  value={primaryValue}
                  isRate={
                    k === 'gross_margin_rate' || k === 'net_profit_rate'
                  }
                  vsPrev={
                    k === 'revenue'
                      ? overview.vsPrevPeriod.revenue
                      : k === 'gross_margin_rate'
                        ? overview.vsPrevPeriod.grossMarginRate
                        : k === 'net_profit_rate'
                          ? overview.vsPrevPeriod.netProfitRate
                          : k === 'operating_cashflow'
                            ? overview.vsPrevPeriod.operatingCashflow
                            : undefined
                  }
                  invert={k === 'operating_cashflow'}
                  trendKey={k}
                  active={activeTrend === k}
                  onClick={() => setActiveTrend(k)}
                  subValue={subValue}
                  subLabel={subLabel}
                />
              );
            })}

            {/* Auxiliary cards */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-3">
              <div className="text-[11px] text-blue-600">银行余额</div>
              <div className="text-sm font-bold text-blue-900 mt-1">
                ¥
                {overview.cashBalance.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                })}
              </div>
              {(overview.beginningBalance ?? 0) > 0 && (
                <div className="text-[10px] text-blue-500 mt-0.5">
                  期初 ¥
                  {overview.beginningBalance.toLocaleString(undefined, {
                    minimumFractionDigits: 0,
                  })}
                  <span className="ml-1">
                    {overview.cashBalance >= overview.beginningBalance
                      ? '↑'
                      : '↓'}
                    {Math.abs(
                      ((overview.cashBalance - overview.beginningBalance) /
                        overview.beginningBalance) *
                        100,
                    ).toFixed(1)}
                    %
                  </span>
                </div>
              )}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-[11px] text-blue-600">门店数</div>
              <div className="text-lg font-bold text-blue-900">
                {overview.storeCount}
              </div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="text-[11px] text-green-600">店均营收</div>
              <div className="text-lg font-bold text-green-900">
                ¥
                {overview.revenuePerStore.toLocaleString(undefined, {
                  minimumFractionDigits: 0,
                })}
              </div>
            </div>
            <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
              <div className="text-[11px] text-purple-600">银行入账率</div>
              <div className="text-lg font-bold text-purple-900">
                {entryRate !== null
                  ? `${(entryRate * 100).toFixed(1)}%`
                  : qimaiRev === null
                    ? '无企迈数据'
                    : '加载中...'}
              </div>
              {bankRevenue !== null && qimaiRev !== null && (
                <div className="text-[10px] text-purple-500 mt-0.5 leading-tight">
                  银行 ¥{bankRevenue.toLocaleString()}
                  <br />
                  企迈 ¥{qimaiRev.toLocaleString()}
                </div>
              )}
            </div>
            <div
              className={`${overview.cashRunway !== null ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'} border rounded-lg p-3`}
            >
              <div
                className={`text-[11px] ${overview.cashRunway !== null ? 'text-amber-600' : 'text-gray-500'}`}
              >
                现金流月数
              </div>
              <div
                className={`text-lg font-bold ${overview.cashRunway !== null ? 'text-amber-900' : 'text-gray-700'}`}
              >
                {overview.cashRunway !== null
                  ? `${overview.cashRunway} 月`
                  : '正向'}
              </div>
            </div>
          </div>

          {overview.ignoreCount > 0 && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 text-xs text-orange-700 flex items-center gap-1">
              <span>ⓘ</span>
              <span>
                包含 <strong>{overview.ignoreCount}</strong>{' '}
                条对冲/冲账记录（负金额），已自动排除出计算
              </span>
            </div>
          )}

          {/* Charts */}
          <div className="space-y-4">
            {trend?.monthly && trend.monthly.length > 0 ? (
              <TrendChart
                data={trend.monthly}
                trendKey={activeTrend}
                period={period}
                format={
                  activeTrend === 'gross_margin_rate' ||
                  activeTrend === 'net_profit_rate'
                    ? (v) => `${(v * 100).toFixed(1)}%`
                    : (v) =>
                        `¥${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                }
              />
            ) : (
              <div className="bg-white border rounded-lg p-4 flex items-center justify-center text-gray-400 text-sm">
                暂无趋势数据
              </div>
            )}
            <ExpenseBreakdown trend={trend} />
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DataHealth stores={stores} />
            <QuickLinks
              span={span}
              period={period}
              store={store}
              brand={brand}
            />
          </div>
        </>
      )}

      <div className="text-xs text-gray-400 text-center py-2">
        本报表基于银行流水按收付实现制编制，仅供参考
      </div>
    </div>
  );
}
