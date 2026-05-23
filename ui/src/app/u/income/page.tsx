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
  amount: number;
  balance_amt: number;
  store_code: string;
  lvl1_name: string | null;
  lvl2_name: string | null;
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

  // Fetch counterparty list
  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/financial/counterparty?brand=${brand}&direction=in`);
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
  }, [brand]);

  // Fetch detail when counterparty selected
  useEffect(() => {
    if (!selected) return;
    async function fetchDetail() {
      setDetailLoading(true);
      try {
        const res = await fetch(
          `/api/financial/counterparty?brand=${brand}&direction=in&counterparty=${encodeURIComponent(selected)}&period=${period}&span=${span}&store=${store}`
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
    for (const [month, items] of map) {
      groups.push({ month, items, total: items.reduce((s, i) => s + Number(i.amount || 0), 0) });
    }
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
                      共 {formatAmt(c.total_received || c.total_paid || 0)} 元 | {c.txn_count} 笔
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
