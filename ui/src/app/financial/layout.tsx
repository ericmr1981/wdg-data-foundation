'use client';

import { useState, useEffect, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';
import ProfitStatement from './profit/page';
import CashflowStatement from './cashflow/page';
import BalanceSheet from './balance-sheet/page';

type TabId = 'profit' | 'cashflow' | 'balance-sheet';
type SpanId = 'month' | 'quarter' | 'year';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profit', label: '利润表' },
  { id: 'cashflow', label: '现金流量表' },
  { id: 'balance-sheet', label: '资产负债表' },
];

function useStores(brand: string) {
  const [stores, setStores] = useState<string[]>([]);
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setStores(json.data.map((s: any) => s.store_code));
        }
      })
      .catch(() => {});
  }, [brand]);
  return stores;
}

export default function FinancialLayout() {
  const { brand } = useBrand();
  const [activeTab, setActiveTab] = useState<TabId>('profit');
  const [span, setSpan] = useState<SpanId>('month');
  const [period, setPeriod] = useState('2026-01');
  const [store, setStore] = useState('all');

  const periodOptions = useMemo(() => {
    if (span === 'month') {
      return ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'];
    }
    if (span === 'quarter') {
      return ['2025-Q3', '2025-Q4', '2026-Q1'];
    }
    return ['2025', '2026'];
  }, [span]);

  useEffect(() => {
    setPeriod(periodOptions[periodOptions.length - 1] || '2026-01');
  }, [span, periodOptions]);

  const stores = useStores(brand);

  const renderStatement = () => {
    const props = { brand, period, span, store };
    switch (activeTab) {
      case 'profit': return <ProfitStatement {...props} />;
      case 'cashflow': return <CashflowStatement {...props} />;
      case 'balance-sheet': return <BalanceSheet {...props} />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">跨度:</label>
          <select
            value={span}
            onChange={e => setSpan(e.target.value as SpanId)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="month">月</option>
            <option value="quarter">季度</option>
            <option value="year">年</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">期间:</label>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            {periodOptions.map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">门店:</label>
          <select
            value={store}
            onChange={e => setStore(e.target.value)}
            className="border rounded px-2 py-1 text-sm bg-white"
          >
            <option value="all">全部</option>
            {stores.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`
                pb-2 px-1 text-sm font-medium border-b-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }
              `}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Statement content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {renderStatement()}
      </div>
    </div>
  );
}
