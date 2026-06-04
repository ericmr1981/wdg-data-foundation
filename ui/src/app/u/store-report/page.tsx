'use client';

import { useState, useEffect, useCallback } from 'react';
import { useBrand } from '@/lib/brand-context';
import { fetchBrands } from '@/lib/brands-client';
import { fetchSnapshot, fetchTrend, exportUrl, pdfUrl } from '@/lib/store-report-queries';
import type { ApiResult, SnapshotResponse, StoreKpi, TrendResponse } from '@/lib/store-report-types';
import { StoreFilter, defaultMonth } from './StoreFilter';
import { KpiCards } from './KpiCards';
import { TrendChart } from './TrendChart';

const BRAND_OPTIONS_HARDCODED = [
  { code: 'gelatomiiix', name: 'Gelatomiiix' },
  { code: 'bonjur', name: 'Bonjur' },
  { code: 'xintiandi', name: 'Xintiandi' },
];

interface StoreOpt { code: string; name: string; }

export default function StoreReportPage() {
  const { brand: ctxBrand, setBrand: setCtxBrand } = useBrand();
  const [brandOptions, setBrandOptions] = useState(BRAND_OPTIONS_HARDCODED);
  const brand = ctxBrand;
  const setBrand = setCtxBrand;
  const [stores, setStores] = useState<StoreOpt[]>([]);
  const [store, setStore] = useState('');
  const [month, setMonth] = useState(defaultMonth());

  const [snapshot, setSnapshot] = useState<SnapshotResponse | null>(null);
  const [trend, setTrend] = useState<TrendResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBrands()
      .then(rows => {
        if (rows.length) setBrandOptions(rows.map(r => ({ code: r.brand_code, name: r.brand_name })));
      })
      .catch(() => {});
  }, []);

  // PDF mode: hide nav/buttons for cleaner output
  // Also: read ?brand= from URL on mount, so quick links with brand param take effect
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('pdfMode') === '1') {
        document.body.classList.add('pdf-mode');
      }
      const urlBrand = params.get('brand');
      if (urlBrand && urlBrand !== brand) {
        setBrand(urlBrand);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉门店列表
  useEffect(() => {
    setStores([]);
    setStore('');
    fetch(`/api/stores?brand=${encodeURIComponent(brand)}`)
      .then(r => r.json())
      .then((d: ApiResult<Array<{ store_code: string; store_name: string }>>) => {
        if (d.success && d.data && d.data.length > 0) {
          const mapped = d.data.map(s => ({ code: s.store_code, name: s.store_name }));
          setStores(mapped);
          setStore(mapped[0].code);
        } else {
          setStores([]);
        }
      })
      .catch(() => setStores([]));
  }, [brand]);

  const loadTrend = useCallback(async (b: string, s: string) => {
    if (!s) return;
    const r = await fetchTrend(b, s, 12);
    if (r.success && r.data) setTrend(r.data);
    else setTrend(null);
  }, []);

  const loadSnapshot = useCallback(async (b: string, s: string, m: string) => {
    if (!s || !m) return;
    setLoading(true);
    setError(null);
    setNote(null);
    const r = await fetchSnapshot(b, s, m);
    if (r.success && r.data) {
      setSnapshot(r.data);
      if (r.note) setNote(r.note);
    } else {
      setSnapshot(null);
      setError(r.error ?? '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (store && month) loadSnapshot(brand, store, month);
  }, [brand, store, month, loadSnapshot]);

  useEffect(() => {
    if (store) loadTrend(brand, store);
  }, [brand, store, loadTrend]);

  const current: StoreKpi | null = snapshot?.current ?? null;

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
        brandOptions={brandOptions}
        onBrandChange={setBrand}
        stores={stores}
        store={store}
        onStoreChange={setStore}
        month={month}
        onMonthChange={setMonth}
      />

      {note && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 mb-4 text-sm text-yellow-700">
          {note}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border-l-4 border-red-400 p-3 mb-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && <div className="text-sm text-gray-500 mb-4">加载中…</div>}

      {current && snapshot && (
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

      {!current && !loading && !error && (
        <div className="text-sm text-gray-500 mt-8 text-center">
          请选择门店和月份查看月报
        </div>
      )}
    </div>
  );
}
