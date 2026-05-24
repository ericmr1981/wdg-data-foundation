'use client';

import { useEffect, useState, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

interface CounterpartySummary {
  counterparty_name: string;
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
    map.forEach((items, month) => {
      groups.push({ month, items, total: items.reduce((s, i) => s + Number(i.amount || 0), 0) });
    });
    groups.sort((a, b) => b.month.localeCompare(a.month));
    return groups;
  }, [txns]);

  const formatAmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

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

      {/* ===== 银行入账率区块 ===== */}
      {brand === 'gelatomiiix' && (
        <div className="mt-8 pt-8 border-t">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">银行入账率</h2>
          <BankEntryRateSection brand={brand} span={span} period={period} periodOptions={periodOptions} />
        </div>
      )}
    </div>
  );
}

const CHANNEL_COLORS: Record<string, string> = {
  WECHAT: 'bg-green-50 border-green-200 text-green-800',
  ALIPAY: 'bg-blue-50 border-blue-200 text-blue-800',
  MEITUAN: 'bg-orange-50 border-orange-200 text-orange-800',
  UNIONPAY: 'bg-gray-50 border-gray-200 text-gray-800',
};
const CHANNEL_LABELS: Record<string, string> = {
  WECHAT: '微信支付',
  ALIPAY: '支付宝',
  MEITUAN: '美团/蜜可诗',
  UNIONPAY: '云闪付',
};

interface BankEntryData {
  channels: { channel: string; qimai_net_amt: number; bank_entry_amt: number; entry_rate: number }[];
  monthly_trend: { month: string; qimai_net_amt: number; bank_entry_amt: number }[];
  unmatched_orders: { channel: string; order_count: number; unentered_amt: number }[];
}

function BankEntryRateSection({ brand, span, period, periodOptions }: {
  brand: string; span: string; period: string; periodOptions: string[];
}) {
  const [data, setData] = useState<BankEntryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectivePeriod = period === 'all'
    ? periodOptions.filter(p => p !== 'all').at(-1) ?? '2026-01'
    : period;

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/gelatomiiix/income/bank-entry-stats?brand=${brand}&period=${effectivePeriod}`)
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
            })),
            monthly_trend: (d.monthlyTrend || []).map((r: any) => ({
              month: r.month,
              qimai_net_amt: parseFloat(r.qimai_net_amt) || 0,
              bank_entry_amt: parseFloat(r.bank_entry_amt) || 0,
            })),
            unmatched_orders: (d.unmatchedOrders || []).map((r: any) => ({
              channel: r.channel,
              order_count: parseInt(r.order_count) || 0,
              unentered_amt: parseFloat(r.unentered_amt) || 0,
            })),
          });
        } else {
          setError(json.error ?? '加载失败');
        }
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [brand, effectivePeriod]);

  if (loading) return (
    <div className="grid grid-cols-4 gap-4">
      {[0,1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />)}
    </div>
  );
  if (error) return <div className="text-red-600 text-sm">{error}</div>;
  if (!data) return null;

  const displayChannels = data.channels.filter(c => c.channel !== 'TOTAL');

  return (
    <div className="space-y-6">
      {/* Metric cards */}
      <div className="grid grid-cols-3 gap-4">
        {displayChannels.map(ch => {
          const isLow = ch.entry_rate < 95;
          const colorClass = isLow
            ? 'bg-red-50 border-red-200 text-red-800'
            : (CHANNEL_COLORS[ch.channel] ?? 'bg-gray-50 border-gray-200 text-gray-800');
          return (
            <div key={ch.channel} className={`border rounded-lg p-4 ${colorClass}`}>
              <div className="text-sm font-medium mb-2">{CHANNEL_LABELS[ch.channel] ?? ch.channel}</div>
              <div className="text-xs opacity-70 mb-1">
                企迈实收 {ch.qimai_net_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元
              </div>
              <div className="text-xs opacity-70 mb-2">
                银行入账 {ch.bank_entry_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })} 元
              </div>
              <div className="text-2xl font-bold font-mono">{ch.entry_rate.toFixed(1)}%</div>
            </div>
          );
        })}
      </div>

      {/* Line chart */}
      {data.monthly_trend && data.monthly_trend.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data.monthly_trend}>
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

      {/* Unmatched orders table */}
      {data.unmatched_orders && data.unmatched_orders.filter(o => o.channel !== 'OTHER').length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 text-sm font-semibold">未入账订单明细</div>
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">渠道</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">未入账订单数</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">未入账金额（元）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {data.unmatched_orders.filter(o => o.channel !== 'OTHER').map(row => (
                <tr key={row.channel} className="hover:bg-gray-50">
                  <td className="px-4 py-2">{CHANNEL_LABELS[row.channel] ?? row.channel}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.order_count.toLocaleString('zh-CN')}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-600">
                    {row.unentered_amt.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
