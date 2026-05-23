'use client';

import { useEffect, useState, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';

interface CounterpartySummary {
  counterparty_name: string;
  total_paid: number;
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
  out_amt: number;
  balance_amt: number;
  store_code: string;
  lvl1_name: string | null;
  lvl2_name: string | null;
}

interface PaymentLvl1 {
  lvl1_code: string;
  lvl1_name: string;
  amount: number;
}

interface PaymentTrend {
  month: string;
  amount: number;
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
  const [store, setStore] = useState('all');
  const [stores, setStores] = useState<{ code: string; name: string }[]>([]);
  const [search, setSearch] = useState('');

  // Payment metrics
  const [metrics, setMetrics] = useState<{ total_out: number; by_lvl1: PaymentLvl1[]; monthly_trend: PaymentTrend[] } | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  const periodOptions = useMemo(() => {
    const base = ['all'] as string[];
    if (span === 'month') return [...base, '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    if (span === 'quarter') return [...base, '2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
    return [...base, '2025', '2026'];
  }, [span]);

  useEffect(() => {
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

  // Fetch payment metrics
  useEffect(() => {
    if (!brand) return;
    setMetricsLoading(true);
    fetch(`/api/financial/payment-metrics?brand=${brand}&period=${period}&span=${span}&store=${store}`)
      .then(r => r.json())
      .then(json => { if (json.success) setMetrics(json.data); })
      .catch(() => {})
      .finally(() => setMetricsLoading(false));
  }, [brand, period, span, store]);

  // Fetch counterparty list (filtered by period/span/store)
  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ brand, period, span });
        if (store !== 'all') params.set('store', store);
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
  }, [brand, period, span, store]);

  // Fetch detail when counterparty selected
  useEffect(() => {
    if (!selected) return;
    async function fetchDetail() {
      setDetailLoading(true);
      try {
        const res = await fetch(
          `/api/financial/counterparty?brand=${brand}&counterparty=${encodeURIComponent(selected)}&period=${period}&span=${span}&store=${store}`
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
  }, [brand, selected, period, span, store]);

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
      groups.push({ month, items, total: items.reduce((s, i) => s + Number(i.out_amt || 0), 0) });
    });
    groups.sort((a, b) => b.month.localeCompare(a.month));
    return groups;
  }, [txns]);

  const formatAmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">付款分析</h1>
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

      {/* Payment Metrics */}
      {metrics && !metricsLoading && (
        <div className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-xs text-gray-500 uppercase tracking-wider">付款总金额</div>
              <div className="text-2xl font-bold text-gray-900 mt-1">
                {metrics.total_out.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">元</div>
            </div>
            {/* Lvl1 Top 2 */}
            {metrics.by_lvl1.slice(0, 2).map(item => {
              const pct = metrics.total_out > 0 ? ((item.amount / metrics.total_out) * 100).toFixed(1) : '0';
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

          {/* Lvl1 Breakdown Table */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">按一级分类</h3>
            <div className="space-y-2">
              {metrics.by_lvl1.map(item => {
                const pct = metrics.total_out > 0 ? (item.amount / metrics.total_out) * 100 : 0;
                return (
                  <div key={item.lvl1_code} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-24 truncate">{item.lvl1_name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2.5 overflow-hidden">
                      <div className="bg-blue-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-20 text-right">
                      {item.amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-xs text-gray-400 w-12 text-right">{pct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Monthly Trend Bar Chart */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">付款趋势（近12个月）</h3>
            <div className="flex items-end gap-1 h-32">
              {metrics.monthly_trend.map(p => {
                const maxAmt = Math.max(...metrics.monthly_trend.map(x => x.amount), 1);
                const h = (p.amount / maxAmt) * 100;
                return (
                  <div key={p.month} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${p.month}: ${p.amount.toLocaleString()}`}>
                    <div className="w-full bg-blue-100 rounded-t hover:bg-blue-400 transition-colors" style={{ height: `${h}%` }} />
                    <span className="text-[9px] text-gray-400 truncate w-full text-center">{p.month.substring(5)}月</span>
                  </div>
                );
              })}
            </div>
          </div>
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
                filtered.map(c => (
                  <div
                    key={c.counterparty_name || '(unnamed)'}
                    onClick={() => setSelected(c.counterparty_name || '')}
                    className={`px-3 py-2.5 border-b last:border-b-0 cursor-pointer hover:bg-blue-50 transition-colors text-sm ${
                      selected === c.counterparty_name ? 'bg-blue-100 border-l-2 border-l-blue-500' : ''
                    }`}
                  >
                    <div className="font-medium truncate">{c.counterparty_name || '(未知名)'}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      共 {formatAmt(c.total_paid)} 元 | {c.txn_count} 笔
                    </div>
                  </div>
                ))
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
                <div className="flex justify-center py-12 text-gray-400">该期间无付款记录</div>
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
                              <td className="px-3 py-2 whitespace-nowrap text-right font-mono">{formatAmt(Number(t.out_amt || 0))}</td>
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
