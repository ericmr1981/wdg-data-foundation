'use client';

import { useState, useEffect, useMemo } from 'react';
import { useBrand } from '@/lib/brand-context';
import ProfitStatement from './profit/profit-tab';
import CashflowStatement from './cashflow/cashflow-tab';
import BalanceSheet from './balance-sheet/balance-sheet-tab';
import OverviewPanel from './overview-panel';
import CounterpartyTab from './counterparty/counterparty-tab';

type TabId = 'profit' | 'cashflow' | 'balance-sheet' | 'counterparty';
type SpanId = 'month' | 'quarter' | 'year';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profit', label: '利润表' },
  { id: 'cashflow', label: '现金流量表' },
  { id: 'balance-sheet', label: '资产负债表' },
  { id: 'counterparty', label: '付款分析' },
];

function useStores(brand: string) {
  const [stores, setStores] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(json => {
        if (json.success) {
          setStores(json.data.map((s: any) => ({ code: s.store_code, name: s.store_name })));
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
      return ['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
    }
    if (span === 'quarter') {
      return ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
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
      case 'counterparty': return <CounterpartyTab {...props} />;
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
              <option key={s.code} value={s.code}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 收付实现制声明 */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>披露声明：</strong>本报表基于银行流水按<strong>收付实现制（现金收付基础）</strong>编制，与按企业会计准则要求以权责发生制编制的法定财务报表存在差异。本报表不构成完整的会计核算，仅供参考。主要差异包括但不限于：不包含应收账款/应付账款、存货、固定资产折旧等权责发生制调整项目。
      </div>

      {/* 经营概览 */}
      <OverviewPanel brand={brand} period={period} span={span} store={store} />

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
