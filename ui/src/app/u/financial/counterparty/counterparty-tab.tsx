'use client';

import { useEffect, useState, useMemo } from 'react';

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

interface CounterpartyTabProps {
  brand: string;
  period: string;
  span: string;
  store: string;
}

export default function CounterpartyTab({ brand, period, span, store }: CounterpartyTabProps) {
  const [counterparties, setCounterparties] = useState<CounterpartySummary[]>([]);
  const [selected, setSelected] = useState('');
  const [txns, setTxns] = useState<TxnDetail[]>([]);
  const [periodTotal, setPeriodTotal] = useState(0);
  const [periodCount, setPeriodCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch counterparty list
  useEffect(() => {
    async function fetchList() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/financial/counterparty?brand=${brand}`);
        const json = await res.json();
        if (json.success) {
          setCounterparties(json.data.counterparties || []);
        } else {
          setError(json.error);
        }
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

  // Group transactions by month
  const monthlyGroups = useMemo(() => {
    const groups: { month: string; items: TxnDetail[]; total: number }[] = [];
    const map = new Map<string, TxnDetail[]>();
    for (const t of txns) {
      const key = t.month || t.txn_time.substring(0, 7);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    map.forEach((items, month) => {
      groups.push({
        month,
        items,
        total: items.reduce((s, i) => s + Number(i.out_amt || 0), 0)
      });
    });
    groups.sort((a, b) => b.month.localeCompare(a.month));
    return groups;
  }, [txns]);

  const formatAmt = (v: number) => v.toLocaleString('zh-CN', { minimumFractionDigits: 2 });

  if (loading) return <div className="flex justify-center py-12 text-gray-500">加载中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      {/* Counterparty selector + summary */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">选择付款对方</label>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="w-full border rounded-md px-3 py-2 text-sm"
            size={10}
          >
            {counterparties.map(c => (
              <option key={c.counterparty_name} value={c.counterparty_name}>
                {c.counterparty_name || '(未知名)'}
                {' | 共 ' + formatAmt(c.total_paid) + ' 元 | ' + c.txn_count + ' 笔'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Selected detail */}
      {selected && (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-900">
            所选期间合计：<strong>{formatAmt(periodTotal)} 元</strong>（{periodCount} 笔）
          </div>

          {detailLoading ? (
            <div className="flex justify-center py-8 text-gray-500">加载中...</div>
          ) : monthlyGroups.length === 0 ? (
            <div className="flex justify-center py-8 text-gray-400">该期间无付款记录</div>
          ) : (
            monthlyGroups.map(group => (
              <div key={group.month} className="border rounded-lg overflow-hidden">
                <div className="bg-gray-100 px-4 py-2 text-sm font-semibold flex justify-between">
                  <span>{group.month}（{group.items.length} 笔，合计 {formatAmt(group.total)} 元）</span>
                </div>
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">时间</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">门店</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">用途</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">摘要</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">附言</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">金额</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">分类</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {group.items.map((t, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">
                          {t.txn_time ? String(t.txn_time).substring(0, 16) : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{t.store_code}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{t.purpose || '-'}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{t.summary || '-'}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{t.memo || '-'}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-right font-mono">
                          {formatAmt(Number(t.out_amt || 0))}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {[t.lvl1_name, t.lvl2_name].filter(Boolean).join(' / ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          )}
        </>
      )}

      {!selected && !loading && (
        <div className="flex justify-center py-12 text-gray-400">请从上方列表选择付款对方</div>
      )}
    </div>
  );
}
