'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useBrand } from '@/lib/brand-context';
import { getErrorMessage } from '@/lib/query-types';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface CounterpartySummary {
  counterparty_name: string;
  lvl1_code: string;
  lvl1_name: string;
  total_paid: number;
  total_received?: number;
  txn_count: number;
  first_date: string;
  last_date: string;
}

interface TxnDetail {
  month: string;
  txn_time: string;
  summary: string | null;
  memo: string | null;
  purpose: string | null;
  amount: number;
  balance_amt: number;
  store_code: string;
  lvl1_name: string | null;
  lvl2_name: string | null;
}

interface IncomeLvl1 {
  lvl1_code: string;
  lvl1_name: string;
  amount: number;
}

interface IncomeLvl2 {
  lvl1_code: string;
  lvl1_name: string;
  lvl2_code: string;
  lvl2_name: string;
  amount: number;
}

// Tamkoko 支付宝+微信对账 (parent-company 苏州泰柯) — declared-range matching
type CycleRow = {
  bank_date_str: string;
  bank_amt: number;
  window_kind: 'weekly' | 'monthly' | 'fallback';
  ref_year: number;
  summary: string;
  window_start: string | null;       // YYYY-MM-DD strings (not Date objects → no UTC shift)
  window_end: string | null;
  window_days: number | null;
  qimai_count: number;
  qimai_amt: number;
  diff: number;
  entry_rate: number;
}

interface TaobaoRow {
  bank_date_str: string;
  bank_amt: number;
  summary: string;
  qimai_window: string;
  window_days: number;
  qimai_count: number;
  qimai_total: number;
  diff: number;
  entry_rate: number;
}

interface MeituanRow {
  bank_date: string;
  bank_date_str: string;
  store_code?: string;
  bank_count?: number;
  bank_amt: number;
  qimai_date?: string;
  qimai_window?: string;
  window_days?: number;
  qimai_count: number;
  qimai_amt: number;
  qimai_total?: number;
  diff: number;
  entry_rate: number;
}

interface MeituanData {
  rows: MeituanRow[];
}

export default function PaymentPage() {
  const { brand } = useBrand();
  const [counterparties, setCounterparties] = useState<CounterpartySummary[]>([]);
  const [selected, setSelected] = useState('');
  const [txns, setTxns] = useState<TxnDetail[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [periodCount, setPeriodCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [span, setSpan] = useState<'month' | 'quarter' | 'year'>('month');
  const [period, setPeriod] = useState('all');
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [search, setSearch] = useState('');

  // Read store from URL synchronously so initial child render uses the right
  // value (avoids 1st useEffect firing with store='all' before URL effect runs).
  const [store, setStore] = useState(() => {
    if (typeof window !== 'undefined') {
      const s = new URLSearchParams(window.location.search).get('store');
      return s || 'all';
    }
    return 'all';
  });
  const [stores, setStores] = useState<{ code: string; name: string }[]>([]);

  // Update URL whenever store/period/span changes, so refreshes keep the
  // selection. Without this, refreshing sends the user back to the default
  // ("all") and the page appears to ignore their dropdown choice.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (store && store !== 'all') params.set('store', store);
    else params.delete('store');
    if (period && period !== 'all') params.set('period', period);
    else params.delete('period');
    if (span && span !== 'month') params.set('span', span);
    else params.delete('span');
    const next = params.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (next !== current) {
      const url = window.location.pathname + (next ? '?' + next : '');
      window.history.replaceState(null, '', url);
    }
  }, [store, period, span]);

  const urlParamsLoadedRef = useRef(true);

  // 从 URL 参数继承筛选条件（仅在首次加载时）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('span');
    const p = params.get('period');
    const st = params.get('store');
    if (s && ['month', 'quarter', 'year'].includes(s)) setSpan(s as any);
    if (p) setPeriod(p);
    if (st) setStore(st);
  }, []);

  // Income metrics
  const [metrics, setMetrics] = useState<{ total_in: number; by_lvl1: IncomeLvl1[]; by_lvl2: IncomeLvl2[] } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const periodOptions = useMemo(() => {
    const base = ['all'] as string[];
    if (span === 'month') return [...base, '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    if (span === 'quarter') return [...base, '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
    return [...base, '2025', '2026'];
  }, [span]);

  useEffect(() => {
    if (!urlParamsLoadedRef.current) return;
    setPeriod(prev => prev === 'all' ? 'all' : periodOptions[periodOptions.length - 1] || '2026-01');
  }, [span, periodOptions]);

  // Fetch stores
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(json => { if (json.success) setStores(json.data.map((s: any) => ({ code: s.store_code, name: s.store_name }))); })
      .catch(() => {});
  }, [brand]);

  // Fetch income metrics
  useEffect(() => {
    if (!brand) return;
    setMetricsLoading(true);
    fetch(`/api/financial/income-metrics?brand=${brand}&period=${period}&span=${span}&store=${store}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setMetrics(json.data);
        else console.error('income-metrics fetch failed', json);
      })
      .catch(err => console.error('income-metrics fetch error', err))
      .finally(() => setMetricsLoading(false));
  }, [brand, period, span, store]);

  // Fetch counterparty list
  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ brand, direction: 'in' });
        if (period !== 'all') params.set('period', period);
        if (span) params.set('span', span);
        if (store !== 'all') params.set('store', store);
        if (selectedChannel) params.set('lvl2_code', selectedChannel);
        const res = await fetch(`/api/financial/counterparty?${params}`);
        const json = await res.json();
        if (json.success) setCounterparties(json.data.counterparties || []);
        else setError(json.error);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchList();
  }, [brand, period, span, store, selectedChannel]);

  // Fetch detail when counterparty selected
  useEffect(() => {
    if (!selected) return;
    async function fetchDetail() {
      setDetailLoading(true);
      try {
        const res = await fetch(
          `/api/financial/counterparty?brand=${brand}&direction=in&counterparty=${encodeURIComponent(selected)}&period=${period}&span=${span}&store=${store}${selectedChannel ? `&lvl2_code=${selectedChannel}` : ''}`
        );
        const json = await res.json();
        if (json.success) {
          setTxns(json.data.transactions || []);
          setPeriodTotal(Number(json.data.period_total || 0));
          setPeriodCount(Number(json.data.period_count || 0));
        }
      } catch (err: any) {
        console.error(err);
      } finally {
        setDetailLoading(false);
      }
    }
    fetchDetail();
  }, [brand, selected, period, span, store, selectedChannel]);

  const filtered = useMemo(() => {
    if (!search) return counterparties;
    const q = search.toLowerCase();
    return counterparties.filter(c => c.counterparty_name?.toLowerCase().includes(q));
  }, [counterparties, search]);

  const monthlyGroups = useMemo(() => {
    const groups: { month: string; items: TxnDetail[]; total: number }[] = [];
    const map = new Map<string, TxnDetail[]>();
    for (const t of txns) {
      const key = t.month || t.txn_time.substring(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    map.forEach((items, month) => {
      groups.push({ month, items, total: items.reduce((s, i) => s + Number(i.amount || 0), 0) });
    });
    groups.sort((a, b) => b.month.localeCompare(a.month));
    return groups;
  }, [txns]);

  const formatAmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

  const fmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">收入分析</h1>
        <div className="flex items-center gap-3">
          <select value={span} onChange={e => setSpan(e.target.value as any)} className="border rounded px-2 py-1 text-sm bg-white">
            <option value="month">按月</option>
            <option value="quarter">按季</option>
            <option value="year">按年</option>
          </select>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
            {periodOptions.map(p => <option key={p} value={p}>{p === 'all' ? '全部' : p}</option>)}
          </select>
          <select value={store} onChange={e => setStore(e.target.value)} className="border rounded px-2 py-1 text-sm bg-white">
            <option value="all">全部门店</option>
            {stores.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
          </select>
        </div>
      </div>

      {/* Income Metrics */}
      {metrics && !metricsLoading && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider">收款总金额</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {metrics.total_in.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">元</div>
            </div>
            {metrics.by_lvl1.slice(0, 2).map(item => {
              const pct = metrics.total_in > 0 ? ((item.amount / metrics.total_in) * 100).toFixed(1) : '0';
              return (
                <div key={item.lvl1_code} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="text-xs text-gray-500 uppercase tracking-wider">{item.lvl1_name}</div>
                  <div className="text-xl font-bold text-gray-900 mt-1">
                    {item.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">占比 {pct}%</div>
                </div>
              );
            })}
          </div>

          {/* Lvl2 Breakdown Table */}
          {metrics.by_lvl2.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">按二级分类</h3>
              <div className="space-y-2">
                {metrics.by_lvl2.map(item => {
                  const pct = metrics.total_in > 0 ? (item.amount / metrics.total_in) * 100 : 0;
                  return (
                    <div key={`${item.lvl1_code}:${item.lvl2_code}`} className="flex items-center gap-3">
                      <span className="text-xs text-gray-600 w-32 truncate" title={`${item.lvl1_name} / ${item.lvl2_name}`}>
                        {item.lvl1_name} / {item.lvl2_name}
                      </span>
                      <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                        <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 w-20 text-right">
                        {item.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                      </span>
                      <span className="text-xs text-gray-400 w-12 text-right">{pct.toFixed(1)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===== 银行入账率区块 ===== */}
      {brand && (
        <div className="mt-8 pt-8 border-t">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">银行入账率</h2>
          <BankEntryRateSection brand={brand} span={span} period={period} store={store}
            channel={selectedChannel} onChannelChange={setSelectedChannel} />
        </div>
      )}

      {/* ===== 对账区块 ===== */}
      {brand && (
        <div className="mt-8 pt-8 border-t space-y-4">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">渠道对账</h2>
          {brand === 'tamkoko' && (
            <>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">支付宝+微信对账</summary>
                <div className="p-4"><SettlementCycleSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">淘宝闪购对账</summary>
                <div className="p-4"><TaobaoReconSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">美团外卖对账</summary>
                <div className="p-4"><MeituanReconSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">美团团购券对账</summary>
                <div className="p-4"><MeituanTuangouSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">抖音团购券对账</summary>
                <div className="p-4"><DouyinReconSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
            </>
          )}
          {brand === 'gelatomiiix' && (
            <>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">微信对账</summary>
                <div className="p-4"><GelatoWechatSection brand={brand} period={period} span={span} store={store} /></div>
              </details>
              <details className="border rounded-lg bg-white">
                <summary className="px-4 py-3 font-medium text-sm cursor-pointer hover:bg-gray-50">支付宝对账</summary>
                <div className="p-4"><GelatoAlipaySection brand={brand} period={period} span={span} store={store} /></div>
              </details>
            </>
          )}
        </div>
      )}

      <div className="flex gap-6">
        {/* Left: counterparty list */}
        <div className="w-80 flex-shrink-0">
          <input
            type="text"
            placeholder="搜索对方名称..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm mb-2"
          />
          <div className="border rounded-lg overflow-hidden">
            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="p-4 text-sm text-gray-500">加载中...</div>
              ) : error ? (
                <div className="p-4 text-sm text-red-600">{error}</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-sm text-gray-400">无数据</div>
              ) : (
                (() => {
                  const groups = new Map<string, typeof filtered>();
                  for (const c of filtered) {
                    const key = c.lvl1_name || c.lvl1_code || '未分类';
                    if (!groups.has(key)) groups.set(key, []);
                    groups.get(key)!.push(c);
                  }
                  return Array.from(groups.entries()).map(([groupName, items]) => (
                    <div key={groupName}>
                      <div className="px-3 py-1.5 bg-gray-100 text-xs font-semibold text-gray-600 border-b sticky top-0">
                        {groupName}
                      </div>
                      {items.map(c => (
                        <div
                          key={c.counterparty_name || '(unnamed)'}
                          onClick={() => setSelected(c.counterparty_name || '')}
                          className={`px-3 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-blue-50 transition-colors text-sm ${
                            selected === c.counterparty_name ? 'bg-blue-100 border-l-2 border-l-blue-500' : ''
                          }`}
                        >
                          <div className="font-medium truncate">{c.counterparty_name || '(未知名)'}</div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            共 {formatAmt(c.total_received || c.total_paid || 0)} 元 | {c.txn_count} 笔
                          </div>
                        </div>
                      ))}
                    </div>
                  ));
                })()
              )}
            </div>
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="flex justify-center py-20 text-gray-400">请从左侧列表选择付款对方</div>
          ) : detailLoading ? (
            <div className="flex justify-center py-20 text-gray-500">加载中...</div>
          ) : (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-900">
                <strong>{selected}</strong> ｜ 所选期间合计：<strong>{formatAmt(periodTotal)} 元</strong>（{periodCount} 笔）
              </div>

              {monthlyGroups.length === 0 ? (
                <div className="flex justify-center py-12 text-gray-400">该期间无收入记录</div>
              ) : (
                monthlyGroups.map(group => (
                  <div key={group.month} className="border rounded-lg overflow-hidden">
                    <div className="bg-gray-100 px-4 py-2 text-sm font-semibold flex justify-between">
                      <span>{group.month}</span>
                      <span className="text-gray-600">{group.items.length} 笔，合计 {formatAmt(group.total)} 元</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200 text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">时间</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">门店</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">用途</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">摘要</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">附言</th>
                            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">金额</th>
                            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">分类</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {group.items.map((t, idx) => (
                            <tr key={idx} className="hover:bg-gray-50">
                              <td className="px-3 py-2 whitespace-nowrap text-gray-600">{t.txn_time ? String(t.txn_time).substring(0, 16) : '-'}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{t.store_code}</td>
                              <td className="px-3 py-2 max-w-[180px] truncate" title={t.purpose || ''}>{t.purpose || '-'}</td>
                              <td className="px-3 py-2 max-w-[180px] truncate" title={t.summary || ''}>{t.summary || '-'}</td>
                              <td className="px-3 py-2 max-w-[150px] truncate" title={t.memo || ''}>{t.memo || '-'}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-right font-mono">{formatAmt(Number(t.amount || 0))}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{[t.lvl1_name, t.lvl2_name].filter(Boolean).join(' / ') || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const CHANNEL_COLORS: Record<string, string> = {
  WECHAT: 'bg-green-50 border-green-200 text-green-800',
  ALIPAY: 'bg-blue-50 border-blue-200 text-blue-800',
  MEITUAN: 'bg-orange-50 border-orange-200 text-orange-800',
  MEITUAN_TUANGOU: 'bg-amber-50 border-amber-200 text-amber-800',
  CLOUD_PAY: 'bg-gray-50 border-gray-200 text-gray-800',
  UNIONPAY: 'bg-gray-50 border-gray-200 text-gray-800',
  DOUYIN: 'bg-pink-50 border-pink-200 text-pink-800',
  ELEME: 'bg-yellow-50 border-yellow-200 text-yellow-800',
  JD: 'bg-red-50 border-red-200 text-red-800',
  TAOBAO: 'bg-purple-50 border-purple-200 text-purple-800',
  WECHAT_ALIPAY: 'bg-teal-50 border-teal-200 text-teal-800',
};
const CHANNEL_LABELS: Record<string, string> = {
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  MEITUAN: '美团',
  MEITUAN_TUANGOU: '美团团购券',
  CLOUD_PAY: '云闪付',
  UNIONPAY: '云闪付',
  DOUYIN: '抖音团购券',
  ELEME: '饿了么',
  JD: '京东',
  TAOBAO: '淘宝闪购',
  WECHAT_ALIPAY: '微信+支付宝',
};

interface BankEntryChannel {
  channel: string;
  qimai_net_amt: number;
  bank_entry_amt: number;
  entry_rate: number;
  month_qimai_amt: number;
  month_bank_amt: number;
}
interface BankEntryData {
  channels: BankEntryChannel[];
  monthly_trend: { month: string; qimai_net_amt: number; bank_entry_amt: number }[];
  unmatched_orders: { month: string; channel: string; order_count: number; unentered_amt: number }[];
}

function BankEntryRateSection({ brand, span, period, store, channel, onChannelChange }: {
  brand: string; span: string; period: string; store: string;
  channel: string; onChannelChange: (ch: string) => void;
}) {
  const [data, setData] = useState<BankEntryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const storeParam = store && store !== 'all' ? `&store=${encodeURIComponent(store)}` : '';
    const periodParam = period && period !== 'all' ? `&period=${period}` : '';
    const channelParam = channel ? `&channel=${encodeURIComponent(channel)}` : '';
    fetch(`/api/income/bank-entry-stats?brand=${brand}&span=${span}${periodParam}${storeParam}${channelParam}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          const d = json.data;
          setData({
            channels: (d.channelMetrics || []).map((r: any) => ({
              channel: r.channel,
              qimai_net_amt: parseFloat(r.qimai_net_amt) || 0,
              bank_entry_amt: parseFloat(r.bank_entry_amt) || 0,
              entry_rate: parseFloat(r.entry_rate) || 0,
              month_qimai_amt: parseFloat(r.month_qimai_amt) || 0,
              month_bank_amt: parseFloat(r.month_bank_amt) || 0,
            })),
            monthly_trend: (d.monthlyTrend || []).map((r: any) => ({
              month: r.month,
              qimai_net_amt: parseFloat(r.qimai_net_amt) || 0,
              bank_entry_amt: parseFloat(r.bank_entry_amt) || 0,
            })),
            unmatched_orders: (d.unmatchedOrders || []).map((r: any) => ({
              month: r.month,
              channel: r.channel,
              order_count: parseInt(r.order_count) || 0,
              unentered_amt: parseFloat(r.unentered_amt) || 0,
            })),
          });
        } else if (json.data === null && json.note) {
          setData(null);
        } else {
          setError(json.error ?? '加载失败');
        }
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, span, period, store, channel, onChannelChange]);

  if (loading) return (
    <div className="grid grid-cols-4 gap-4">
      {[0,1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />)}
    </div>
  );
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data) return null;

  const displayChannels = data.channels.filter(c => c.channel !== 'TOTAL' && c.channel !== 'OTHER' && c.channel !== 'ELEME');

  // Aggregate monthly_trend (per month × channel) → per-month totals.
  // X axis = month, two series: 企迈实收, 银行入账 (sum across channels).
  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const monthlyAggMap = new Map<string, { qimai_net_amt: number; bank_entry_amt: number }>();
  for (const r of data.monthly_trend) {
    const cur = monthlyAggMap.get(r.month) ?? { qimai_net_amt: 0, bank_entry_amt: 0 };
    cur.qimai_net_amt += safeNum(r.qimai_net_amt);
    cur.bank_entry_amt += safeNum(r.bank_entry_amt);
    monthlyAggMap.set(r.month, cur);
  }
  const monthlyTrendByMonth = Array.from(monthlyAggMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v }));

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4">
        {displayChannels.map(ch => {
          const rate = ch.entry_rate;

          // 4-tier entry-rate color spec for BankEntryRateSection cards.
          // No per-channel hue override — strict tier → color mapping.
          //
          //  Tier        | Rate range     | Background   | Border       | Text         | Meaning
          //  ------------|----------------|--------------|--------------|--------------|----------------------------
          //  dark-green  | 96% – 104%    | emerald-100  | emerald-300  | emerald-900  | 银行入账与企迈订单金额几乎完全对账
          //  light-green | 92% – 106%    | emerald-50   | emerald-200  | emerald-700  | 对账金额在合理范围内 (含部分抽佣/退款)
          //  yellow      | 90% – 110%    | yellow-50    | yellow-300   | yellow-800   | 对账有偏差, 但仍可接受 (可能有跨期订单)
          //  red         | 其它          | red-50       | red-300      | red-800      | 异常 — 需人工核查 (抽佣/退款/数据缺失)
          //
          // Note: tier ranges overlap (96% is both dark-green and light-green,
          // 104% is dark-green and light-green, etc.). The if-else chain checks
          // dark-green first so the most precise tier wins.
          const tier = (rate >= 96 && rate <= 104) ? 'dark-green'   // 最准
                     : (rate >= 92 && rate <= 106) ? 'light-green'  // 健康
                     : (rate >= 90 && rate <= 110) ? 'yellow'       // 偏偏差
                     : 'red';                                      // 异常
          const TIER_COLORS = {
            'dark-green':  'bg-emerald-100 border-emerald-300 text-emerald-900',
            'light-green': 'bg-emerald-50  border-emerald-200 text-emerald-700',
            'yellow':      'bg-yellow-50   border-yellow-300  text-yellow-800',
            'red':         'bg-red-50      border-red-300     text-red-800',
          } as const;
          const colorClass = TIER_COLORS[tier];
          return (
            <div
              key={ch.channel}
              onClick={() => onChannelChange(ch.channel === channel ? '' : ch.channel)}
              className={`border rounded-lg p-4 cursor-pointer transition-all ${colorClass} ${
                ch.channel === channel
                  ? 'ring-2 ring-blue-500 shadow-lg scale-105 z-10'
                  : channel
                    ? 'opacity-25 hover:opacity-90'
                    : 'hover:shadow-sm'
              }`}
            >
              <div className="text-sm font-medium mb-2">{CHANNEL_LABELS[ch.channel] ?? ch.channel}</div>
              <div className="text-xs opacity-70 mb-1">
                企迈实收 {ch.qimai_net_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元
                {ch.month_qimai_amt > 0 && <span className="ml-1 opacity-50">({ch.month_qimai_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })})</span>}
              </div>
              <div className="text-xs opacity-70 mb-2">
                银行入账 {ch.bank_entry_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元
                {ch.month_bank_amt > 0 && <span className="ml-1 opacity-50">({ch.month_bank_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })})</span>}
              </div>
              <div className="text-2xl font-bold font-mono">{Number(ch.entry_rate).toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* Line chart — X axis is month (YYYY-MM), two series: 企迈实收 vs 银行入账 */}
      {monthlyTrendByMonth.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={monthlyTrendByMonth}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={v => (v / 10000).toFixed(0) + '万'} />
            <Tooltip formatter={(v: unknown) => Number(v).toLocaleString('zh-CN', { minimumFractionDigits: 2 }) + ' 元'} />
            <Legend />
            <Line type="monotone" dataKey="qimai_net_amt" name="企迈实收" stroke="#1677FF" strokeWidth={2} />
            <Line type="monotone" dataKey="bank_entry_amt" name="银行入账" stroke="#52C41A" strokeDasharray="5 5" />
          </LineChart>
        </ResponsiveContainer>
      )}

    </div>
  );
}

function CollapsibleTableRows({ rows, maxVisible = 5, children }: {
  rows: any[];
  maxVisible?: number;
  children: (row: any, idx: number) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? rows : rows.slice(0, maxVisible);
  return (
    <>
      {visible.map((row, idx) => children(row, idx))}
      {rows.length > maxVisible && !expanded && (
        <tr>
          <td colSpan={99} className="text-center py-2">
            <button onClick={() => setExpanded(true)} className="text-xs text-blue-600 hover:underline">
              ... 还有 {rows.length - maxVisible} 行，点击展开
            </button>
          </td>
        </tr>
      )}
      {expanded && rows.length > maxVisible && (
        <tr>
          <td colSpan={99} className="text-center py-2">
            <button onClick={() => setExpanded(false)} className="text-xs text-blue-600 hover:underline">
              收起
            </button>
          </td>
        </tr>
      )}
    </>
  );
}

// ============================
// 支付宝+微信对账 (Tamkoko) — 苏州泰柯总公司转账 vs 企迈微信/支付宝订单
// ============================
function SettlementCycleSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<{ rows: CycleRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    fetch(`/api/income/cycle-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tBank = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const tQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_amt), 0));
  const tDiff = tBank - tQimai;
  const tCount = data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
  const tEffDays = data.rows.reduce((s, r) => s + safeNum(r.window_days), 0);
  const tRate = tQimai > 0 ? (tBank / tQimai) * 100 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">转账日期</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">类型</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">摘要</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">窗口</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">转账金额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">覆盖天数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">订单笔数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">订单金额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          <CollapsibleTableRows rows={data.rows} maxVisible={15}>
            {(r, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                    r.window_kind === 'weekly' ? 'bg-blue-100 text-blue-700' :
                    r.window_kind === 'monthly' ? 'bg-amber-100 text-amber-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {r.window_kind === 'weekly' ? '周结' :
                     r.window_kind === 'monthly' ? '月结' : '回退'}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-gray-500 max-w-[160px] truncate" title={r.summary}>{r.summary || '-'}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs font-mono text-gray-600">
                  {r.window_start && r.window_end
                    ? `${r.window_start.slice(5)}~${r.window_end.slice(5)}`
                    : '-'}
                </td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                <td className="px-3 py-2 text-right">{safeNum(r.window_days)}</td>
                <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_amt)}</td>
                <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) < 0 ? 'text-red-600' : safeNum(r.diff) > 0 ? 'text-green-600' : ''}`}>
                  {safeNum(r.diff) >= 0 ? '+' : ''}{fmt(r.diff)}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${
                  safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                }`}>
                  {safeNum(r.entry_rate).toFixed(1)}%
                </td>
              </tr>
            )}
          </CollapsibleTableRows>
        </tbody>
        <tfoot className="bg-gray-100 font-semibold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">合计 ({data.rows.length} 笔)</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(tBank)}</td>
            <td className="px-3 py-2 text-right">{tEffDays}</td>
            <td className="px-3 py-2 text-right">{tCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(tQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${tDiff < 0 ? 'text-red-600' : tDiff > 0 ? 'text-green-600' : ''}`}>
              {tDiff >= 0 ? '+' : ''}{fmt(tDiff)}
            </td>
            <td className="px-3 py-2 text-right font-mono">{tRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 淘宝闪购对账 (Tamkoko)// ============================
// 淘宝闪购对账 (Tamkoko)
// ============================
function TaobaoReconSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<{ rows: TaobaoRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    fetch(`/api/income/taobao-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_total), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDays = safeNum(data.rows.reduce((s, r) => s + safeNum(r.window_days), 0));
  const totDiff = totBank - totQimai;
  const totRate = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">匹配窗口</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">窗口天数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          <CollapsibleTableRows rows={data.rows} maxVisible={10}>
            {(r, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-xs">{r.qimai_window || '-'}</td>
                <td className="px-3 py-2 text-right">{safeNum(r.window_days)}</td>
                <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_total)}</td>
                <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                <td className="px-3 py-2 text-right font-mono">{safeNum(r.entry_rate).toFixed(1)}%</td>
              </tr>
            )}
          </CollapsibleTableRows>
        </tbody>
        <tfoot className="bg-gray-100 font-semibold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">合计</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right">{totDays}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className="px-3 py-2 text-right font-mono">{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 美团外卖对账 (Tamkoko)
// ============================
function MeituanReconSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<MeituanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    sp.set('t_offset', '3');  // T+3 calibrated against 202 bank entries
    fetch(`/api/income/meituan-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank  = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_amt), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDiff  = totBank - totQimai;
  const totRate  = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  // Group rows by month (YYYY-MM from bank_date_str)
  const monthGroups = new Map<string, MeituanRow[]>();
  for (const r of data.rows) {
    const month = (r.bank_date_str || r.bank_date || '').substring(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month)!.push(r);
  }
  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="overflow-x-auto space-y-2">
      {sortedMonths.map(month => {
        const monthRows = monthGroups.get(month)!;
        const mBank  = monthRows.reduce((s, r) => s + safeNum(r.bank_amt), 0);
        const mQimai = monthRows.reduce((s, r) => s + safeNum(r.qimai_amt), 0);
        const mCount = monthRows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
        const mDiff  = mBank - mQimai;
        const mRate  = mQimai > 0 ? (mBank / mQimai) * 100 : 0;
        return (
          <details key={month} className="border rounded bg-white">
            <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="font-medium">{month}</span>
              <span className="text-xs text-gray-500">({monthRows.length} 笔)</span>
              <span className="ml-auto text-xs text-gray-600">
                银行 {fmt(mBank)} · 企迈 {fmt(mQimai)} ·{' '}
                <span className={mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'}>
                  {mRate.toFixed(1)}%
                </span>
              </span>
            </summary>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">对应企迈日</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str || r.bank_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.qimai_date || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_amt)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                    }`}>{safeNum(r.entry_rate).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-2 text-xs text-gray-600">月小计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono">{fmt(mBank)}</td>
                  <td className="px-3 py-2 text-right">{mCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(mQimai)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(mDiff)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'
                  }`}>{mRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </details>
        );
      })}
      {/* Grand total row */}
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">总计</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className={`px-3 py-2 text-right font-mono ${
              totRate >= 80 && totRate <= 105 ? 'text-green-700' : 'text-red-700'
            }`}>{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 美团团购券对账 (Tamkoko)
// ============================
function MeituanTuangouSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<MeituanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    sp.set('t_offset', '5');  // T+5 — total sum accuracy preferred over per-row
    fetch(`/api/income/meituan-tuangou-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank  = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_amt ?? r.qimai_total), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDiff  = totBank - totQimai;
  const totRate  = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  // Group rows by month
  const monthGroups = new Map<string, MeituanRow[]>();
  for (const r of data.rows) {
    const month = (r.bank_date_str || r.bank_date || '').substring(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month)!.push(r);
  }
  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="overflow-x-auto space-y-2">
      {sortedMonths.map(month => {
        const monthRows = monthGroups.get(month)!;
        const mBank  = monthRows.reduce((s, r) => s + safeNum(r.bank_amt), 0);
        const mQimai = monthRows.reduce((s, r) => s + safeNum(r.qimai_amt ?? r.qimai_total), 0);
        const mCount = monthRows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
        const mDiff  = mBank - mQimai;
        const mRate  = mQimai > 0 ? (mBank / mQimai) * 100 : 0;
        return (
          <details key={month} className="border rounded bg-white">
            <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="font-medium">{month}</span>
              <span className="text-xs text-gray-500">({monthRows.length} 笔)</span>
              <span className="ml-auto text-xs text-gray-600">
                银行 {fmt(mBank)} · 企迈 {fmt(mQimai)} ·{' '}
                <span className={mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'}>
                  {mRate.toFixed(1)}%
                </span>
              </span>
            </summary>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">匹配窗口</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">窗口天数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str || r.bank_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.qimai_window || '-'}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.window_days)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_amt ?? r.qimai_total)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                    }`}>{safeNum(r.entry_rate).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-2 text-xs text-gray-600">月小计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono">{fmt(mBank)}</td>
                  <td className="px-3 py-2 text-right">{mCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(mQimai)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(mDiff)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'
                  }`}>{mRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </details>
        );
      })}
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">总计</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className={`px-3 py-2 text-right font-mono ${
              totRate >= 80 && totRate <= 105 ? 'text-green-700' : 'text-red-700'
            }`}>{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 抖音团购券对账 (Tamkoko)
// ============================
function DouyinReconSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<MeituanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    sp.set('t_offset', '5');  // T+5
    fetch(`/api/income/douyin-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank  = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_amt), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDiff  = totBank - totQimai;
  const totRate  = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  // Group rows by month
  const monthGroups = new Map<string, MeituanRow[]>();
  for (const r of data.rows) {
    const month = (r.bank_date_str || r.bank_date || '').substring(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month)!.push(r);
  }
  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="overflow-x-auto space-y-2">
      {sortedMonths.map(month => {
        const monthRows = monthGroups.get(month)!;
        const mBank  = monthRows.reduce((s, r) => s + safeNum(r.bank_amt), 0);
        const mQimai = monthRows.reduce((s, r) => s + safeNum(r.qimai_amt), 0);
        const mCount = monthRows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
        const mDiff  = mBank - mQimai;
        const mRate  = mQimai > 0 ? (mBank / mQimai) * 100 : 0;
        return (
          <details key={month} className="border rounded bg-white">
            <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="font-medium">{month}</span>
              <span className="text-xs text-gray-500">({monthRows.length} 笔)</span>
              <span className="ml-auto text-xs text-gray-600">
                银行 {fmt(mBank)} · 企迈 {fmt(mQimai)} ·{' '}
                <span className={mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'}>
                  {mRate.toFixed(1)}%
                </span>
              </span>
            </summary>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">对应企迈日</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str || r.bank_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.qimai_date || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_amt)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                    }`}>{safeNum(r.entry_rate).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-2 text-xs text-gray-600">月小计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono">{fmt(mBank)}</td>
                  <td className="px-3 py-2 text-right">{mCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(mQimai)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(mDiff)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'
                  }`}>{mRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </details>
        );
      })}
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">总计</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className={`px-3 py-2 text-right font-mono ${
              totRate >= 80 && totRate <= 105 ? 'text-green-700' : 'text-red-700'
            }`}>{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 蜜可诗微信对账
// ============================
function GelatoWechatSection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<MeituanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    sp.set('t_offset', '1');  // 微信 T+1 calibrated
    fetch(`/api/income/gelato-wechat-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank  = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_amt), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDiff  = totBank - totQimai;
  const totRate  = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  // Group rows by month
  const monthGroups = new Map<string, MeituanRow[]>();
  for (const r of data.rows) {
    const month = (r.bank_date_str || r.bank_date || '').substring(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month)!.push(r);
  }
  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="overflow-x-auto space-y-2">
      {sortedMonths.map(month => {
        const monthRows = monthGroups.get(month)!;
        const mBank  = monthRows.reduce((s, r) => s + safeNum(r.bank_amt), 0);
        const mQimai = monthRows.reduce((s, r) => s + safeNum(r.qimai_amt), 0);
        const mCount = monthRows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
        const mDiff  = mBank - mQimai;
        const mRate  = mQimai > 0 ? (mBank / mQimai) * 100 : 0;
        return (
          <details key={month} className="border rounded bg-white">
            <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="font-medium">{month}</span>
              <span className="text-xs text-gray-500">({monthRows.length} 笔)</span>
              <span className="ml-auto text-xs text-gray-600">
                银行 {fmt(mBank)} · 企迈 {fmt(mQimai)} ·{' '}
                <span className={mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'}>
                  {mRate.toFixed(1)}%
                </span>
              </span>
            </summary>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">对应企迈日</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str || r.bank_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.qimai_date || '-'}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_amt)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                    }`}>{safeNum(r.entry_rate).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-2 text-xs text-gray-600">月小计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono">{fmt(mBank)}</td>
                  <td className="px-3 py-2 text-right">{mCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(mQimai)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(mDiff)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'
                  }`}>{mRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </details>
        );
      })}
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">总计</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className={`px-3 py-2 text-right font-mono ${
              totRate >= 80 && totRate <= 105 ? 'text-green-700' : 'text-red-700'
            }`}>{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ============================
// 蜜可诗支付宝对账
// ============================
function GelatoAlipaySection({ brand, period, span, store }: {
  brand: string; period: string; span: string; store: string;
}) {
  const [data, setData] = useState<MeituanData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const sp = new URLSearchParams({ brand, period, span });
    if (store && store !== 'all') sp.set('store', store);
    sp.set('t_offset', '4');  // 支付宝 T+4 (LAG window_end = bank_date - 4)
    fetch(`/api/income/gelato-alipay-recon?${sp}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) setData(json.data);
        else setError(json.error ?? '加载失败');
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [brand, period, span, store]);

  if (loading) return <div className="text-sm text-gray-500">加载中...</div>;
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data || !data.rows.length) return <div className="text-sm text-gray-400">无数据</div>;

  const safeNum = (n: unknown): number => {
    const v = Number(n ?? 0);
    return Number.isFinite(v) ? v : 0;
  };
  const fmt = (n: unknown) => safeNum(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const totBank  = safeNum(data.rows.reduce((s, r) => s + safeNum(r.bank_amt), 0));
  const totQimai = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_total ?? r.qimai_amt), 0));
  const totCount = safeNum(data.rows.reduce((s, r) => s + safeNum(r.qimai_count), 0));
  const totDiff  = totBank - totQimai;
  const totRate  = totQimai > 0 ? (totBank / totQimai) * 100 : 0;

  // Group rows by month
  const monthGroups = new Map<string, MeituanRow[]>();
  for (const r of data.rows) {
    const month = (r.bank_date_str || r.bank_date || '').substring(0, 7);
    if (!monthGroups.has(month)) monthGroups.set(month, []);
    monthGroups.get(month)!.push(r);
  }
  const sortedMonths = Array.from(monthGroups.keys()).sort().reverse();

  return (
    <div className="overflow-x-auto space-y-2">
      {sortedMonths.map(month => {
        const monthRows = monthGroups.get(month)!;
        const mBank  = monthRows.reduce((s, r) => s + safeNum(r.bank_amt), 0);
        const mQimai = monthRows.reduce((s, r) => s + safeNum(r.qimai_total ?? r.qimai_amt), 0);
        const mCount = monthRows.reduce((s, r) => s + safeNum(r.qimai_count), 0);
        const mDiff  = mBank - mQimai;
        const mRate  = mQimai > 0 ? (mBank / mQimai) * 100 : 0;
        return (
          <details key={month} className="border rounded bg-white">
            <summary className="px-3 py-2 cursor-pointer hover:bg-gray-50 flex items-center gap-3 text-sm">
              <span className="font-medium">{month}</span>
              <span className="text-xs text-gray-500">({monthRows.length} 笔)</span>
              <span className="ml-auto text-xs text-gray-600">
                银行 {fmt(mBank)} · 企迈 {fmt(mQimai)} ·{' '}
                <span className={mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'}>
                  {mRate.toFixed(1)}%
                </span>
              </span>
            </summary>
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">打款日期</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">匹配窗口</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">窗口天数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">银行金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈笔数</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">企迈金额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">差额</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">入账率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {monthRows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">{r.bank_date_str || r.bank_date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500">{r.qimai_window || '-'}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.window_days)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.bank_amt)}</td>
                    <td className="px-3 py-2 text-right">{safeNum(r.qimai_count)}</td>
                    <td className="px-3 py-2 text-right font-mono">{fmt(r.qimai_total ?? r.qimai_amt)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${safeNum(r.diff) !== 0 ? 'text-red-600' : ''}`}>{fmt(r.diff)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${
                      safeNum(r.entry_rate) >= 80 && safeNum(r.entry_rate) <= 105 ? 'text-green-600' : 'text-red-600'
                    }`}>{safeNum(r.entry_rate).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  <td className="px-3 py-2 text-xs text-gray-600">月小计</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono">{fmt(mBank)}</td>
                  <td className="px-3 py-2 text-right">{mCount}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(mQimai)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${mDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(mDiff)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${
                    mRate >= 80 && mRate <= 105 ? 'text-green-700' : 'text-red-700'
                  }`}>{mRate.toFixed(1)}%</td>
                </tr>
              </tfoot>
            </table>
          </details>
        );
      })}
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <tfoot className="bg-gray-100 font-bold">
          <tr>
            <td className="px-3 py-2 whitespace-nowrap">总计</td>
            <td className="px-3 py-2" />
            <td className="px-3 py-2" />
            <td className="px-3 py-2 text-right font-mono">{fmt(totBank)}</td>
            <td className="px-3 py-2 text-right">{totCount}</td>
            <td className="px-3 py-2 text-right font-mono">{fmt(totQimai)}</td>
            <td className={`px-3 py-2 text-right font-mono ${totDiff !== 0 ? 'text-red-600' : ''}`}>{fmt(totDiff)}</td>
            <td className={`px-3 py-2 text-right font-mono ${
              totRate >= 80 && totRate <= 105 ? 'text-green-700' : 'text-red-700'
            }`}>{totRate.toFixed(1)}%</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}