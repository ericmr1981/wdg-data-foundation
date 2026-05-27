'use client';

import { useState, useEffect } from 'react';
import { useBrand, BRAND_OPTIONS } from '@/lib/brand-context';

interface CashRegisterRow {
  biz_date: string;
  order_no: string;
  gross_amt: number;
  revenue_amt: number;
  net_amt: number;
  payment_methods: string[];
}

interface ProductRow {
  biz_date: string;
  order_no: string;
  product_name: string;
  unit_price: number;
  qty: number;
  sales_amt: number;
  received_amt: number;
  discount_amt: number;
}

interface StoreOption {
  store_code: string;
  store_name: string;
}

const DETAIL_TABS = ['收银明细', '商品销售明细'] as const;

import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

export default function SalesDetailsPage() {
  const { brand } = useBrand();
  const brandLabel = BRAND_OPTIONS.find(b => b.code === brand)?.name || brand;

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeCode, setStoreCode] = useState('');
  const [month, setMonth] = useState('2026-04');
  const [pureMode, setPureMode] = useState(false);
  const [page, setPage] = useState(1);
  const [cashData, setCashData] = useState<CashRegisterRow[]>([]);
  const [productData, setProductData] = useState<ProductRow[]>([]);
  const [distribution, setDistribution] = useState<{ range: string; count: number }[]>([]);
  const [hourlyData, setHourlyData] = useState<{ order_hour: string; order_cnt: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [subTab, setSubTab] = useState(0);
  const limit = 50;

  // Fetch stores based on brand
  useEffect(() => {
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.length) {
          const opts = json.data as StoreOption[];
          setStores(opts);
          setStoreCode(opts[0].store_code);
        }
      })
      .catch(() => {});
  }, [brand]);

  useEffect(() => { setPage(1); }, [storeCode, month, subTab, pureMode]);

  useEffect(() => {
    if (storeCode) fetchDetails();
  }, [storeCode, month, subTab, page, pureMode]);

  const apiBase = brand === 'gelatomiiix' ? 'gelatomiiix' : 'bonjur';

  async function fetchDetails() {
    setLoading(true);
    const type = subTab === 0 ? 'cash_register' : 'product';
    const params = new URLSearchParams({ store_code: storeCode, month, type, page: String(page), limit: String(limit) });
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/${apiBase}/sales/details?${params}`);
    const json = await res.json();
    if (json.success) {
      if (type === 'cash_register') {
        setCashData(json.data);
      } else {
        setProductData(json.data);
      }
      setTotal(json.total || 0);
    }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">{brandLabel} · 销售明细</h1>

      <div className="flex gap-3 flex-wrap">
        <select value={storeCode} onChange={e => { setStoreCode(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm">
          {stores.map(s => <option key={s.store_code} value={s.store_code}>{s.store_name}</option>)}
        </select>
        <input type="month" value={month} onChange={e => { setMonth(e.target.value); setPage(1); }}
          className="border rounded px-3 py-1.5 text-sm" />
        {brand === 'gelatomiiix' && (
          <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
            <input type="checkbox" checked={pureMode} onChange={e => setPureMode(e.target.checked)}
              className="rounded border-gray-300" />
            纯净版
          </label>
        )}
      </div>

      <div className="flex gap-1 border-b">
        {DETAIL_TABS.map((tab, i) => (
          <button key={tab} onClick={() => setSubTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* 收银明细 */}
      {subTab === 0 && (
        <div>
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : cashData.length === 0 ? (
            <div className="text-center text-gray-400 py-8">暂无数据</div>
          ) : (
            <>
              <div className="bg-white border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3 font-medium">日期</th>
                      <th className="text-left p-3 font-medium">订单号</th>
                      <th className="text-right p-3 font-medium">营业额</th>
                      <th className="text-right p-3 font-medium">营业收入</th>
                      <th className="text-right p-3 font-medium">净收</th>
                      <th className="text-left p-3 font-medium">支付方式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashData.map((r, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-3">{r.biz_date}</td>
                        <td className="p-3 font-mono text-xs">{r.order_no}</td>
                        <td className="p-3 text-right">¥{Number(r.gross_amt).toLocaleString()}</td>
                        <td className="p-3 text-right">¥{Number(r.revenue_amt).toLocaleString()}</td>
                        <td className="p-3 text-right">¥{Number(r.net_amt).toLocaleString()}</td>
                        <td className="p-3">{(r.payment_methods || []).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-center items-center gap-3 mt-4 text-sm">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30">上一页</button>
                <span className="text-gray-500">{page} / {totalPages || 1}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30">下一页</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 商品销售明细 */}
      {subTab === 1 && (
        <div>
          {loading ? (
            <div className="text-center text-gray-400 py-8">加载中...</div>
          ) : productData.length === 0 ? (
            <div className="text-center text-gray-400 py-8">暂无数据</div>
          ) : (
            <>
              <div className="flex gap-6">
                <div className="flex-1 bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-sm">销售额分布</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={[{ value: 0 }]}>
                      <XAxis hide /><YAxis hide />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 bg-white border rounded-lg p-4">
                  <h3 className="font-semibold mb-3 text-sm">小时订单分布</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={[{ value: 0 }]}>
                      <XAxis hide /><YAxis hide />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white border rounded-lg overflow-hidden mt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-left p-3 font-medium">日期</th>
                      <th className="text-left p-3 font-medium">订单号</th>
                      <th className="text-left p-3 font-medium">商品</th>
                      <th className="text-right p-3 font-medium">单价</th>
                      <th className="text-right p-3 font-medium">数量</th>
                      <th className="text-right p-3 font-medium">销售额</th>
                      <th className="text-right p-3 font-medium">实收</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productData.map((r, i) => (
                      <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="p-3">{r.biz_date}</td>
                        <td className="p-3 font-mono text-xs">{r.order_no}</td>
                        <td className="p-3">{r.product_name}</td>
                        <td className="p-3 text-right">¥{Number(r.unit_price).toLocaleString()}</td>
                        <td className="p-3 text-right">{r.qty}</td>
                        <td className="p-3 text-right">¥{Number(r.sales_amt).toLocaleString()}</td>
                        <td className="p-3 text-right">¥{Number(r.received_amt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-center items-center gap-3 mt-4 text-sm">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30">上一页</button>
                <span className="text-gray-500">{page} / {totalPages || 1}</span>
                <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1 border rounded disabled:opacity-30">下一页</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
