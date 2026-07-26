'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/lib/brand-context';
import { exportUrl, pdfUrl } from '@/lib/store-report-queries';
import type { SnapshotResponse, TrendResponse } from '@/lib/store-report-types';
import { StoreFilter } from './StoreFilter';
import { KpiCards } from './KpiCards';
import { TrendChart } from './TrendChart';

interface Props {
  brand: string;
  store: string;
  month: string;
  pdfMode: boolean;
  brands: Array<{ code: string; name: string }>;
  stores: Array<{ code: string; name: string }>;
  snapshot: SnapshotResponse | null;
  snapshotNote?: string;
  trend: TrendResponse | null;
  trendNote?: string;
}

export function StoreReportClient({
  brand,
  store,
  month,
  pdfMode,
  brands,
  stores,
  snapshot,
  snapshotNote,
  trend,
  trendNote,
}: Props) {
  const router = useRouter();
  const { setBrand: setCtxBrand } = useBrand();

  // Sync brand cookie / NavBar selector with the URL-derived brand.
  useEffect(() => {
    setCtxBrand(brand);
  }, [brand]); // eslint-disable-line react-hooks/exhaustive-deps

  // pdfMode: hide nav/buttons for cleaner PDF output.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (pdfMode) {
      document.body.classList.add('pdf-mode');
    } else {
      document.body.classList.remove('pdf-mode');
    }
  }, [pdfMode]);

  function navigate(next: { brand?: string; store?: string; month?: string }) {
    const params = new URLSearchParams();
    const b = next.brand ?? brand;
    const s = next.store ?? store;
    const m = next.month ?? month;
    params.set('brand', b);
    if (s) params.set('store', s);
    params.set('month', m);
    if (pdfMode) params.set('pdfMode', '1');
    router.push(`/u/store-report?${params.toString()}`);
  }

  const note = snapshotNote ?? trendNote;
  const hasData = Boolean(snapshot || (trend && trend.months.length > 0));

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">门店月报</h1>
        {store && month && (
          <div className="no-pdf flex items-center gap-2">
            <a
              href={exportUrl(brand, store, month)}
              className="text-sm border rounded px-3 py-1.5 bg-white hover:bg-gray-50"
              download
            >
              ⬇ 下载 Excel
            </a>
            <a
              href={pdfUrl(brand, store, month)}
              className="text-sm border rounded px-3 py-1.5 bg-white hover:bg-gray-50"
              download
            >
              ⬇ 下载 PDF
            </a>
          </div>
        )}
      </div>

      <StoreFilter
        brand={brand}
        brandOptions={brands}
        onBrandChange={(b) => navigate({ brand: b, store: '' })}
        stores={stores}
        store={store}
        onStoreChange={(s) => navigate({ store: s })}
        month={month}
        onMonthChange={(m) => navigate({ month: m })}
      />

      {note && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-700">
          {note === 'view not ready' ? '数据视图尚未生成，请稍后再试。' : note}
        </div>
      )}

      {!hasData && !note && store && (
        <div className="text-sm text-gray-500 mb-4">
          暂无数据（{store} @ {month}）
        </div>
      )}

      {!store && (
        <div className="text-sm text-gray-500 mt-8 text-center">
          该品牌下暂无门店
        </div>
      )}

      {snapshot && (
        <KpiCards current={snapshot.current} previous={snapshot.previous} />
      )}

      {trend && trend.months.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <TrendChart title="营业收入趋势 (12月)" trend={trend} metrics={['revenue_amt']} barMetric="revenue_amt" />
          <TrendChart title="营业支出趋势 (12月)" trend={trend} metrics={['expense_amt']} barMetric="expense_amt" />
          <TrendChart title="毛利 / 毛利率趋势" trend={trend} metrics={['gross_profit_amt', 'gross_profit_rate_pct']} barMetric="gross_profit_amt" />
          <TrendChart title="净利润 / 利润率趋势" trend={trend} metrics={['net_profit_amt', 'net_profit_rate_pct']} barMetric="net_profit_amt" />
          <TrendChart title="经营现金流趋势" trend={trend} metrics={['operating_cf_amt']} barMetric="operating_cf_amt" />
          <TrendChart title="银行余额趋势" trend={trend} metrics={['cash_balance']} barMetric="cash_balance" />
          <TrendChart title="人力占比率趋势" trend={trend} metrics={['hr_ratio_pct']} />
          <TrendChart title="租金占比率趋势" trend={trend} metrics={['rent_ratio_pct']} />
        </div>
      )}
    </div>
  );
}
