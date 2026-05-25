'use client';

import { useState, useEffect } from 'react';

interface CashRegisterRow {
  biz_date: string;
  order_no: string;
  gross_amt: number;
  revenue_amt: number;
  discount_amt: number;
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

const DETAIL_TABS = ['收银明细', '商品销售明细'] as const;

const STORE_OPTIONS = [
  { value: 'sh_xtd', label: '新天地店' },
];

import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

export default function SalesDetailsPage() {
  const [subTab, setSubTab] = useState(0);
  const [storeCode, setStoreCode] = useState('sh_xtd');
  const [month, setMonth] = useState('2026-04');
  const [pureMode, setPureMode] = useState(false);
  const [page, setPage] = useState(1);
  const [cashData, setCashData] = useState<CashRegisterRow[]>([]);
  const [productData, setProductData] = useState<ProductRow[]>([]);
  const [distribution, setDistribution] = useState<{ range: string; count: number }[]>([]);
  const [hourlyData, setHourlyData] = useState<{ order_hour: string; order_cnt: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const limit = 50;

  useEffect(() => { setPage(1); }, [storeCode, month, subTab, pureMode]);

  useEffect(() => { fetchDetails(); }, [storeCode, month, subTab, page, pureMode]);

  async function fetchDetails() {
    setLoading(true);
    const type = subTab === 0 ? 'cash_register' : 'product';
    const params = new URLSearchParams({ store_code: storeCode, month, type, page: String(page), limit: String(limit) });
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/gelatomiiix/sales/details?${params}`);
    const json = await res.json();
    if (json.success) {
      if (subTab === 0) setCashData(json.data);
      else setProductData(json.data);
      setTotal(json.total);
    }
    setLoading(false);
  }

  useEffect(() => {
    const hParams = new URLSearchParams({ store_code: storeCode, month });
    if (pureMode) hParams.set('pure_mode', 'true');
    fetch(`/api/gelatomiiix/sales/hourly?${hParams}`)
      .then(r => r.json())
      .then(j => { if (j.success) setHourlyData(j.data || []); })
      .catch(() => {});
    const dParams = new URLSearchParams({ store_code: storeCode, month });
    if (pureMode) dParams.set('pure_mode', 'true');
    fetch(`/api/gelatomiiix/sales/distribution?${dParams}`)
      .then(r => r.json())
      .then(j => { if (j.success) setDistribution(j.data || []); })
      .catch(() => {});
  }, [storeCode, month, pureMode]);

  const totalPages = Math.ceil(total / limit);



  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">销售明细</h1>

      <div className="flex gap-3 flex-wrap">
        <select value={storeCode} onChange={e => setStoreCode(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm">
          {STORE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm" />
        <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
          <input type="checkbox" checked={pureMode} onChange={e => setPureMode(e.target.checked)}
            className="rounded border-gray-300" />
          纯净版
        </label>
        <span className="text-sm text-gray-500 leading-8">共 {total} 条</span>
      </div>

      <div className="flex gap-1 border-b">
        {DETAIL_TABS.map((tab, i) => (
          <button key={tab} onClick={() => { setSubTab(i); setPage(1); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              subTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Charts (收银明细 tab only) */}
      {subTab === 0 && cashData.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-sm">订单金额分布</h3>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={distribution}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickCount={5} />
                <Tooltip />
                <Bar dataKey="count" name="订单数" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-2 text-sm">时段订单分布</h3>
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={hourlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="order_hour" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="order_cnt" name="订单数" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              {subTab === 0 ? (
                <>
                  <th className="text-left p-3">日期</th>
                  <th className="text-right p-3">营业额</th>
                  <th className="text-right p-3">营业收入</th>
                  <th className="text-right p-3">优惠</th>
                  <th className="text-right p-3">净收</th>
                  <th className="text-right p-3">支付方式</th>
                </>
              ) : (
                <>
                  <th className="text-left p-3">日期</th>
                  <th className="text-right p-3">商品名称</th>
                  <th className="text-right p-3">单价</th>
                  <th className="text-right p-3">数量</th>
                  <th className="text-right p-3">销售额</th>
                  <th className="text-right p-3">优惠</th>
                  <th className="text-right p-3">实收</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {subTab === 0 ? cashData.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-3">{row.biz_date}</td>
                <td className="p-3 text-right">¥{Number(row.gross_amt).toFixed(2)}</td>
                <td className="p-3 text-right">¥{Number(row.revenue_amt).toFixed(2)}</td>
                <td className="p-3 text-right">¥{Number(row.discount_amt || 0).toFixed(2)}</td>
                <td className="p-3 text-right">¥{Number(row.net_amt).toFixed(2)}</td>
                <td className="p-3 text-right">{(row.payment_methods || []).join(', ') || '-'}</td>
              </tr>
            )) : productData.map((row, i) => (
              <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                <td className="p-3">{row.biz_date}</td>
                <td className="p-3 text-right">{row.product_name}</td>
                <td className="p-3 text-right">¥{Number(row.unit_price).toFixed(2)}</td>
                <td className="p-3 text-right">{row.qty}</td>
                <td className="p-3 text-right">¥{Number(row.sales_amt).toFixed(2)}</td>
                <td className="p-3 text-right">¥{Number(row.discount_amt || 0).toFixed(2)}</td>
                <td className="p-3 text-right">¥{Number(row.received_amt).toFixed(2)}</td>
              </tr>
            ))}
            {subTab === 0 && cashData.length === 0 && (
              <tr><td colSpan={6} className="p-3 text-center text-gray-400">暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 border rounded text-sm disabled:opacity-50">上一页</button>
          <span className="px-3 py-1 text-sm text-gray-600">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 border rounded text-sm disabled:opacity-50">下一页</button>
        </div>
      )}
    </div>
  );
}
