'use client';

import { useState, useEffect, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';

type SpanId = 'month' | 'quarter' | 'year';

interface Store { code: string; name: string; }

interface OverviewData {
  revenue: number;
  grossMarginRate: number;
  netProfitRate: number;
  operatingCashflow: number;
  cashBalance: number;
  cashRunway: number | null;
  storeCount: number;
  revenuePerStore: number;
  vsPrevPeriod: {
    revenue: number;
    grossMarginRate: number;
    netProfitRate: number;
    operatingCashflow: number;
  };
}

interface MonthlyKpi {
  month: string;
  revenue: number;
  gross_margin_rate: number;
  net_profit_rate: number;
  operating_cashflow: number;
  expenses: { lvl1_code: string; lvl1_name: string; lvl2_code: string; lvl2_name: string; amount: number }[];
}

interface KpiTrendData {
  monthly: MonthlyKpi[];
  current_month: { revenue: number; expenses: { lvl1_code: string; lvl1_name: string; lvl2_code: string; lvl2_name: string; amount: number }[] } | null;
  prev_month: { revenue: number; expenses: { lvl1_code: string; lvl1_name: string; lvl2_code: string; lvl2_name: string; amount: number }[] } | null;
}

type TrendKey = 'revenue' | 'gross_margin_rate' | 'net_profit_rate' | 'operating_cashflow';

interface StoreHealth {
  store_code: string;
  store_name: string;
  latest_txn: string | null;
}

const TREND_LABELS: Record<TrendKey, string> = {
  revenue: '营业收入',
  gross_margin_rate: '毛利率',
  net_profit_rate: '净利润率',
  operating_cashflow: '经营现金流',
};

const TREND_COLORS: Record<TrendKey, string> = {
  revenue: 'bg-blue-500',
  gross_margin_rate: 'bg-green-500',
  net_profit_rate: 'bg-purple-500',
  operating_cashflow: 'bg-cyan-500',
};

const TREND_BAR_COLORS: Record<TrendKey, string> = {
  revenue: '#3B82F6',
  gross_margin_rate: '#22C55E',
  net_profit_rate: '#A855F7',
  operating_cashflow: '#06B6D4',
};

const EXPENSE_COLORS: Record<string, string> = {
  MATERIAL: 'bg-orange-500', HR: 'bg-blue-500', RENT_UTIL: 'bg-purple-500',
  MKT: 'bg-pink-500', ADMIN: 'bg-teal-500', BUILD: 'bg-amber-500',
  SHIP: 'bg-indigo-500', TAX_SURCHARGE: 'bg-gray-500', EXP_OTHER: 'bg-red-400',
};

function useStores(brand: string) {
  const [stores, setStores] = useState<Store[]>([]);
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`).then(r => r.json()).then(json => {
      if (json.success) setStores(json.data.map((s: { store_code: string; store_name: string }) => ({ code: s.store_code, name: s.store_name })));
    }).catch(() => {});
  }, [brand]);
  return stores;
}

function PeriodSelector({ span, period, setSpan, setPeriod }: { span: SpanId; period: string; setSpan: (v: SpanId) => void; setPeriod: (v: string) => void }) {
  const options = useMemo(() => {
    if (span === 'month') return ['2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12','2026-01','2026-02','2026-03','2026-04','2026-05','2026-06'];
    if (span === 'quarter') return ['2025-Q1','2025-Q2','2025-Q3','2025-Q4','2026-Q1','2026-Q2'];
    return ['2025','2026'];
  }, [span]);
  useEffect(() => { setPeriod(options[options.length - 1] || '2026-01'); }, [span]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <select value={span} onChange={e => setSpan(e.target.value as SpanId)} className="border rounded px-2 py-1 text-sm bg-white">
        <option value="month">月度</option><option value="quarter">季度</option><option value="year">年度</option>
      </select>
      <select value={period} onChange={e => setPeriod(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="w-full bg-gray-100 rounded h-2 overflow-hidden">
      <div className={`h-full rounded transition-all ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function KpiCard({ label, value, prefix = '¥', vsPrev, isRate = false, invert = false, trendKey, active, onClick, noClick }: {
  label: string; value: number; prefix?: string; vsPrev?: number; isRate?: boolean; invert?: boolean;
  trendKey?: TrendKey; active?: boolean; onClick?: () => void; noClick?: boolean;
}) {
  const display = isRate ? `${(value * 100).toFixed(1)}%` : `${prefix}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const vs = vsPrev !== undefined;
  const good = vs ? (invert ? vsPrev <= 0 : vsPrev >= 0) : true;
  return (
    <div
      className={`bg-white border rounded-lg p-3 transition-all ${noClick ? '' : 'cursor-pointer'} ${active ? 'ring-2 ring-blue-400 shadow-md' : 'hover:shadow-sm'}`}
      onClick={!noClick && trendKey ? onClick : undefined}
    >
      <div className="text-[11px] text-gray-500 mb-0.5 truncate">{label}</div>
      <div className="text-lg font-bold text-gray-900">{display}</div>
      {vs && (
        <div className={`text-[11px] mt-0.5 ${good ? 'text-green-600' : 'text-red-600'}`}>
          {vsPrev >= 0 ? '↑' : '↓'} {Math.abs(vsPrev * 100).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

// ── Tooltip bar chart (x-axis oldest→newest) ──────────
function TrendChart({ data, trendKey, format }: { data: MonthlyKpi[]; trendKey: TrendKey; format?: (v: number) => string }) {
  const [tooltip, setTooltip] = useState<{ month: string; value: number; x: number; y: number } | null>(null);
  // API returns newest-first; reverse to show oldest (left) → newest (right)
  const sorted = [...data].reverse();
  const max = Math.max(...sorted.map(d => Math.abs(d[trendKey])), 1);
  const color = TREND_BAR_COLORS[trendKey];
  const fmt = format || ((v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 }));

  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{TREND_LABELS[trendKey]}趋势</h3>
      <div className="flex items-end gap-[3px] h-44 relative">
        {sorted.map(d => {
          const val = d[trendKey];
          const pct = max > 0 ? (Math.abs(val) / max) * 100 : 0;
          return (
            <div key={d.month} className="flex-1 flex flex-col items-center justify-end h-full relative">
              <div
                className="w-full rounded-t transition-all cursor-pointer hover:opacity-80"
                style={{ height: `${Math.max(pct, 1)}%`, backgroundColor: color }}
                onMouseEnter={(e) => {
                  const rect = (e.target as HTMLElement).getBoundingClientRect();
                  setTooltip({ month: d.month, value: val, x: rect.left + rect.width / 2, y: rect.top - 8 });
                }}
                onMouseLeave={() => setTooltip(null)}
              />
              <div className="text-[9px] text-gray-400 mt-1">{d.month.slice(5)}</div>
            </div>
          );
        })}
      </div>
      {tooltip && (
        <div
          className="fixed z-50 bg-gray-900 text-white text-xs rounded px-2 py-1 pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-50%, -100%)' }}
        >
          {tooltip.month}: {fmt(tooltip.value)}
        </div>
      )}
    </div>
  );
}

// ── Expense breakdown by lvl2, grouped by lvl1, accordion ──
function ExpenseBreakdown({ kpiTrend }: { kpiTrend: KpiTrendData | null }) {
  const cur = kpiTrend?.current_month;
  const prev = kpiTrend?.prev_month;
  const expenses = cur?.expenses || [];
  const revenue = cur?.revenue || 1;
  const totalExp = expenses.reduce((s, e) => s + e.amount, 0);

  const prevMap = new Map<string, number>();
  for (const e of prev?.expenses || []) {
    prevMap.set(`${e.lvl1_code}:${e.lvl2_code}`, e.amount);
  }

  const groups = new Map<string, { lvl1_code: string; lvl1_name: string; items: typeof expenses }>();
  for (const e of expenses) {
    const key = e.lvl1_code;
    if (!groups.has(key)) groups.set(key, { lvl1_code: key, lvl1_name: e.lvl1_name || key, items: [] });
    groups.get(key)!.items.push(e);
  }

  const sortedGroups = Array.from(groups.entries())
    .map(([code, g]) => ({ ...g, total: g.items.reduce((s, i) => s + i.amount, 0) }))
    .sort((a, b) => b.total - a.total);

  const maxLvl2Amt = Math.max(...expenses.map(e => e.amount), 1);

  // Accordion: all collapsed by default
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set(sortedGroups.map(g => g.lvl1_code)));

  const toggle = (code: string) => {
    setCollapsedSet(prev => {
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
          {sortedGroups.map(g => {
            const isCollapsed = collapsedSet.has(g.lvl1_code);
            const sortedItems = [...g.items].sort((a, b) => b.amount - a.amount);
            return (
              <div key={g.lvl1_code}>
                {/* Lvl1 header — clickable to toggle */}
                <div
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs font-semibold items-center px-1 mb-1 text-gray-700 cursor-pointer hover:bg-gray-100 rounded py-0.5 select-none"
                  onClick={() => toggle(g.lvl1_code)}
                >
                  <span>{isCollapsed ? '▶' : '▼'} {g.lvl1_name}</span>
                  <span className={`text-right px-1.5 py-0.5 rounded ${g.total > 0 ? 'bg-blue-50 text-blue-800' : ''}`}>
                    ¥{g.total.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                  </span>
                  <span className={`text-right px-1.5 py-0.5 rounded ${g.total > 0 ? 'bg-purple-50 text-purple-800' : ''}`}>
                    {revenue > 0 ? (g.total / Math.abs(revenue) * 100).toFixed(1) : 0}%
                  </span>
                  <span className="text-right text-gray-400">-</span>
                </div>
                {/* Lvl2 items — only show when expanded */}
                {!isCollapsed && sortedItems.map(item => {
                  const momAmt = prevMap.get(`${item.lvl1_code}:${item.lvl2_code}`);
                  // MoM: show when prev exists (even 0). New expense = '新增'.
                  let momText: string, momColor: string;
                  if (momAmt === undefined) { momText = '-'; momColor = 'bg-gray-100 text-gray-400'; }
                  else if (momAmt === 0 && item.amount > 0) { momText = '新增'; momColor = 'bg-orange-100 text-orange-700'; }
                  else if (momAmt === 0) { momText = '0%'; momColor = 'bg-gray-100 text-gray-500'; }
                  else {
                    const pct = (item.amount - momAmt) / momAmt;
                    momText = `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct * 100).toFixed(1)}%`;
                    momColor = pct <= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
                  }
                  const pctOfRev = revenue > 0 ? (item.amount / Math.abs(revenue)) * 100 : 0;
                  const amtBg = item.amount > 0 ? 'bg-blue-50' : '';
                  const pctBg = pctOfRev > 0 ? 'bg-purple-50' : '';
                  return (
                    <div key={`${item.lvl1_code}:${item.lvl2_code}`} className="pl-4 mb-1">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs items-center px-1 mb-0.5">
                        <span className="text-gray-500 truncate text-[11px]">{item.lvl2_name || item.lvl2_code}</span>
                        <span className={`font-mono text-gray-700 text-right text-[11px] px-1.5 py-0.5 rounded ${amtBg}`}>
                          ¥{item.amount.toLocaleString(undefined, { minimumFractionDigits: 0 })}
                        </span>
                        <span className={`text-right w-14 text-[11px] px-1.5 py-0.5 rounded font-medium ${pctBg} ${pctOfRev > 0 ? 'text-purple-700' : 'text-gray-400'}`}>
                          {pctOfRev.toFixed(1)}%
                        </span>
                        <span className={`text-right w-[60px] text-[11px] px-1.5 py-0.5 rounded font-medium ${momColor}`}>
                          {momText}
                        </span>
                      </div>
                      <MiniBar pct={(item.amount / maxLvl2Amt) * 100} color={EXPENSE_COLORS[item.lvl1_code] || 'bg-gray-400'} />
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div className="border-t pt-2 grid grid-cols-[1fr_auto_auto_auto] gap-2 text-xs font-semibold px-1">
            <span className="text-gray-700">合计</span>
            <span className="text-gray-900 text-right">
              ¥{totalExp.toLocaleString(undefined, { minimumFractionDigits: 0 })}
            </span>
            <span className="text-gray-700 text-right">{revenue > 0 ? (totalExp / Math.abs(revenue) * 100).toFixed(1) : 0}%</span>
            <span className="text-right text-gray-400">-</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DataHealth({ brand }: { brand: string }) {
  const [stores, setStores] = useState<StoreHealth[]>([]);
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`).then(r => r.json()).then(async (json) => {
      if (!json.success) return;
      setStores(json.data.map((s: { store_code: string; store_name: string }) => ({ store_code: s.store_code, store_name: s.store_name, latest_txn: null })));
    }).catch(() => {});
  }, [brand]);
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">数据健康</h3>
      {stores.length === 0 ? (
        <div className="text-xs text-gray-400">暂无数据</div>
      ) : (
        <div className="space-y-2 text-xs">
          {stores.map(s => (
            <div key={s.store_code} className="flex justify-between items-center border-b pb-1 last:border-0">
              <span className="font-medium text-gray-700">{s.store_name}</span>
              <span className="text-gray-500">{s.latest_txn ? `最近: ${s.latest_txn.slice(0, 10)}` : '暂无数据'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QuickLinks() {
  const links = [
    { href: '/u/financial', label: '财务报表', desc: '利润表 / 现金流量表 / 资产负债表' },
    { href: '/u/payment', label: '付款分析', desc: '按科目 / 往来方查看支出' },
    { href: '/u/income', label: '收入分析', desc: '收入趋势 / 银行入账率' },
    { href: '/u/sales', label: '销售报表', desc: '各门店销售数据汇总' },
  ];
  return (
    <div className="bg-white border rounded-lg p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">快捷入口</h3>
      <div className="grid grid-cols-2 gap-2">
        {links.map(l => (
          <a key={l.href} href={l.href} className="block p-3 border rounded hover:bg-gray-50 transition-colors">
            <div className="text-sm font-medium text-blue-600">{l.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{l.desc}</div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────
const CLICKABLE_KPIS: TrendKey[] = ['revenue', 'gross_margin_rate', 'net_profit_rate', 'operating_cashflow'];

export default function DashboardPage() {
  const { brand } = useBrand();
  const [span, setSpan] = useState<SpanId>('month');
  const [period, setPeriod] = useState('2026-06');
  const [store, setStore] = useState('all');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [bankRevenue, setBankRevenue] = useState<number | null>(null);
  const [qimaiRevenue, setQimaiRevenue] = useState<number | null>(null);
  const [kpiTrend, setKpiTrend] = useState<KpiTrendData | null>(null);
  const [activeTrend, setActiveTrend] = useState<TrendKey>('revenue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stores = useStores(brand);

  useEffect(() => {
    if (!brand) { setLoading(false); return; }
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/financial/overview?brand=${brand}&period=${period}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),
      fetch(`/api/financial/kpi-trend?brand=${brand}&period=${period}&span=${span}&store=${store}`).then(r => r.json()).catch(() => ({ success: false })),
    ])
      .then(([ov, kt]) => {
        if (ov.success && ov.data) setOverview(ov.data);
        if (kt.success && kt.data) setKpiTrend(kt.data);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    fetch(`/api/financial/qimai-revenue?brand=${brand}&period=${period}&span=${span}&store=${store}`)
      .then(r => r.json()).then(d => {
        if (d.success && d.data) { setBankRevenue(d.data.bank_revenue); setQimaiRevenue(d.data.qimai_revenue); }
      }).catch(() => {});
  }, [brand, period, span, store]);

  // Bank entry rate: only show when a specific store is selected
  const showEntryRate = store !== 'all' && bankRevenue !== null && qimaiRevenue !== null;
  const entryRate = showEntryRate && qimaiRevenue! > 0 ? Math.min(bankRevenue! / qimaiRevenue!, 1) : null;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">经营看板</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodSelector span={span} period={period} setSpan={setSpan} setPeriod={setPeriod} />
          <select
            value={store}
            onChange={e => setStore(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">全部门店</option>
            {stores.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {error && <div className="text-red-600 text-sm bg-red-50 border rounded p-3">{error}</div>}

      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : !overview ? (
        <div className="text-center py-12 text-gray-400">暂无数据（视图未就绪）</div>
      ) : (
        <>
          {/* All cards in one aligned grid: 5 clickable KPI + 4 auxiliary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-5 gap-3">
            {CLICKABLE_KPIS.map(k => (
              <KpiCard
                key={k}
                label={TREND_LABELS[k]}
                value={k === 'revenue' ? overview.revenue : k === 'gross_margin_rate' ? overview.grossMarginRate : k === 'net_profit_rate' ? overview.netProfitRate : overview.operatingCashflow}
                isRate={k === 'gross_margin_rate' || k === 'net_profit_rate'}
                vsPrev={k === 'revenue' ? overview.vsPrevPeriod.revenue : k === 'gross_margin_rate' ? overview.vsPrevPeriod.grossMarginRate : k === 'net_profit_rate' ? overview.vsPrevPeriod.netProfitRate : overview.vsPrevPeriod.operatingCashflow}
                invert={k === 'operating_cashflow'}
                trendKey={k}
                active={activeTrend === k}
                onClick={() => setActiveTrend(k)}
              />
            ))}
            <KpiCard label="期末余额" value={overview.cashBalance} noClick />
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="text-[11px] text-blue-600">门店数</div>
              <div className="text-lg font-bold text-blue-900">{overview.storeCount}</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="text-[11px] text-green-600">店均营收</div>
              <div className="text-lg font-bold text-green-900">¥{overview.revenuePerStore.toLocaleString(undefined, { minimumFractionDigits: 0 })}</div>
            </div>
            {store !== 'all' ? (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-[11px] text-purple-600">银行入账率</div>
                <div className="text-lg font-bold text-purple-900">
                  {entryRate !== null ? `${(entryRate * 100).toFixed(1)}%` : (qimaiRevenue === null ? '无企迈数据' : '加载中...')}
                </div>
                {bankRevenue !== null && qimaiRevenue !== null && (
                  <div className="text-[10px] text-purple-500 mt-0.5 leading-tight">
                    银行 ¥{bankRevenue.toLocaleString()}<br />企迈 ¥{qimaiRevenue.toLocaleString()}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <div className="text-[11px] text-gray-500">银行入账率</div>
                <div className="text-lg font-bold text-gray-400">选择门店</div>
              </div>
            )}
            <div className={`${overview.cashRunway !== null ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'} border rounded-lg p-3`}>
              <div className={`text-[11px] ${overview.cashRunway !== null ? 'text-amber-600' : 'text-gray-500'}`}>现金流月数</div>
              <div className={`text-lg font-bold ${overview.cashRunway !== null ? 'text-amber-900' : 'text-gray-700'}`}>
                {overview.cashRunway !== null ? `${overview.cashRunway} 月` : '正向'}
              </div>
            </div>
          </div>

          {/* Charts: trend on top, expense below */}
          <div className="space-y-4">
            {kpiTrend?.monthly && kpiTrend.monthly.length > 0 ? (
              <TrendChart data={kpiTrend.monthly} trendKey={activeTrend}
                format={activeTrend === 'gross_margin_rate' || activeTrend === 'net_profit_rate'
                  ? (v) => `${(v * 100).toFixed(1)}%`
                  : (v) => `¥${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              />
            ) : (
              <div className="bg-white border rounded-lg p-4 flex items-center justify-center text-gray-400 text-sm">暂无趋势数据</div>
            )}
            <ExpenseBreakdown kpiTrend={kpiTrend} />
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DataHealth brand={brand} />
            <QuickLinks />
          </div>
        </>
      )}

      <div className="text-xs text-gray-400 text-center py-2">
        本报表基于银行流水按收付实现制编制，仅供参考
      </div>
    </div>
  );
}
