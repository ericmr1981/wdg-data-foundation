'use client';

import { useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/lib/brand-context';
import type {
  FinancialStatementLine,
  FinancialStoreRow,
  FinancialOverviewResult,
} from '@/lib/queries/financial';
import ProfitStatement from './profit/profit-tab';
import CashflowStatement from './cashflow/cashflow-tab';
import BalanceSheet from './balance-sheet/balance-sheet-tab';
import OverviewPanel from './overview-panel';

type TabId = 'profit' | 'cashflow' | 'balance-sheet';
type SpanId = 'month' | 'quarter' | 'year';

const TABS: { id: TabId; label: string }[] = [
  { id: 'profit', label: '利润表' },
  { id: 'cashflow', label: '现金流量表' },
  { id: 'balance-sheet', label: '资产负债表' },
];

function periodOptionsForSpan(span: SpanId): string[] {
  if (span === 'month') {
    return ['2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
  }
  if (span === 'quarter') {
    return ['2025-Q1', '2025-Q2', '2025-Q3', '2025-Q4', '2026-Q1', '2026-Q2'];
  }
  return ['2025', '2026'];
}

interface FinancialClientProps {
  brand: string;
  span: SpanId;
  period: string;
  store: string;
  stores: FinancialStoreRow[];
  profitData: FinancialStatementLine[];
  cashflowData: FinancialStatementLine[];
  balanceSheetData: FinancialStatementLine[];
  overviewData: FinancialOverviewResult | null;
  overviewNote?: string;
}

export function FinancialClient({
  brand,
  span,
  period,
  store,
  stores,
  profitData,
  cashflowData,
  balanceSheetData,
  overviewData,
  overviewNote,
}: FinancialClientProps) {
  const router = useRouter();
  const { setBrand: setCtxBrand } = useBrand();

  // Sync brand cookie / NavBar selector
  useEffect(() => {
    setCtxBrand(brand);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodOptions = useMemo(() => periodOptionsForSpan(span), [span]);

  function navigate(next: { span?: SpanId; period?: string; store?: string; tab?: TabId }) {
    const params = new URLSearchParams();
    params.set('brand', brand);
    const nextSpan = next.span ?? span;
    params.set('span', nextSpan);
    const nextPeriod = next.period ?? period;
    params.set('period', nextPeriod);
    const nextStore = next.store ?? store;
    if (nextStore !== 'all') params.set('store', nextStore);
    router.push(`/u/financial?${params.toString()}`);
  }

  function handleSpanChange(newSpan: SpanId) {
    const opts = periodOptionsForSpan(newSpan);
    const defaultPeriod = opts[opts.length - 1] || '';
    navigate({ span: newSpan, period: defaultPeriod, store: 'all' });
  }

  function handlePeriodChange(newPeriod: string) {
    navigate({ period: newPeriod });
  }

  function handleStoreChange(newStore: string) {
    navigate({ store: newStore });
  }

  // Current tab: derived from profit/cashflow/balance-sheet data availability
  // Simple approach: default to 'profit' tab. URLs don't track the tab.
  // Since all data is pre-fetched, we just show whichever tab was active.
  // Tab state is purely client-side (no URL sync needed).
  const tabContent = (id: TabId) => {
    switch (id) {
      case 'profit':
        return <ProfitStatement lines={profitData} />;
      case 'cashflow':
        return <CashflowStatement lines={cashflowData} />;
      case 'balance-sheet':
        return <BalanceSheet lines={balanceSheetData} />;
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
            onChange={e => handleSpanChange(e.target.value as SpanId)}
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
            onChange={e => handlePeriodChange(e.target.value)}
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
            onChange={e => handleStoreChange(e.target.value)}
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
      {overviewNote && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-yellow-800 text-sm">
          数据视图尚未生成，请稍后再试。
        </div>
      )}
      <OverviewPanel data={overviewData} />

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex space-x-8">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`pb-2 px-1 text-sm font-medium border-b-2 transition-colors border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Statement content */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        {/* All 3 tabs rendered with CSS visibility, so tab switching is instant */}
        <div>
          <ProfitStatement lines={profitData} />
        </div>
        <div className="mt-8">
          <CashflowStatement lines={cashflowData} />
        </div>
        <div className="mt-8">
          <BalanceSheet lines={balanceSheetData} />
        </div>
      </div>
    </div>
  );
}
