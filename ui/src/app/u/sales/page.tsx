'use client';

import { useState, useEffect } from 'react';
import { useBrand, BRAND_OPTIONS } from '@/lib/brand-context';

interface KpiData {
  gross_sales_amt: number;
  revenue_amt: number;
  discount_amt: number;
  net_amt: number;
  order_cnt: number;
  avg_order_amt: number | null;
}

interface DailyData {
  biz_date: string;
  gross_sales_amt: number;
  revenue_amt: number;
  order_cnt: number;
}

interface PrevMonthData {
  gross_sales_amt: number;
  order_cnt: number;
}

interface ProductData {
  product_name: string;
  total_qty: number;
  total_received_amt: number;
}

interface ChannelData {
  payment_method: string;
  txn_cnt: number;
  gross_amt: number;
  revenue_amt: number;
  pct: number;
}

interface TrendData {
  month: string;
  gross_sales_amt: number;
  revenue_amt: number;
  order_cnt: number;
}

interface StoreOption {
  store_code: string;
  store_name: string;
}

const TABS = ['门店概览', '商品分析', '支付渠道', '月度趋势'] as const;

const PAYMENT_OPTIONS = [
  { value: '', label: '全部渠道' },
  { value: '微信支付', label: '微信支付' },
  { value: '支付宝支付', label: '支付宝支付' },
  { value: '现金支付', label: '现金支付' },
  { value: '美团团购券', label: '美团团购券' },
  { value: '抖音团购券', label: '抖音团购券' },
  { value: '云闪付', label: '云闪付' },
  { value: '免支付', label: '免支付' },
  { value: '自定义结账方式', label: '自定义结账方式' },
];

import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

const CHART_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export default function SalesReportPage() {
  const { brand } = useBrand();
  const brandLabel = BRAND_OPTIONS.find(b => b.code === brand)?.name || brand;

  const [stores, setStores] = useState<StoreOption[]>([]);
  const [storeCode, setStoreCode] = useState('');
  const [month, setMonth] = useState('2026-04');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [pureMode, setPureMode] = useState(false);

  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [daily, setDaily] = useState<DailyData[]>([]);
  const [prevMonth, setPrevMonth] = useState<PrevMonthData | null>(null);
  const [products, setProducts] = useState<{by_sales: ProductData[]; by_qty: ProductData[]}>({by_sales: [], by_qty: []});
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [trend, setTrend] = useState<TrendData[]>([]);
  const [activeTab, setActiveTab] = useState(0);

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

  useEffect(() => {
    if (!storeCode) return;
    fetchOverview();
    fetchProducts();
    fetchChannels();
    fetchTrend();
  }, [storeCode, month, paymentMethod, pureMode]);

  const apiBase = brand === 'gelatomiiix' ? 'gelatomiiix' : 'bonjur';

  async function fetchOverview() {
    const params = new URLSearchParams({ store_code: storeCode, month });
    if (paymentMethod) params.set('payment_method', paymentMethod);
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/${apiBase}/sales/overview?${params}`);
    const json = await res.json();
    if (json.success && json.data) {
      setKpi(json.data.kpi);
      setDaily(json.data.daily || []);
      setPrevMonth(json.data.prev_month);
    }
  }

  async function fetchProducts() {
    const params = new URLSearchParams({ store_code: storeCode, month });
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/${apiBase}/sales/products?${params}`);
    const json = await res.json();
    if (json.success) setProducts(json.data || { by_sales: [], by_qty: [] });
  }

  async function fetchChannels() {
    const params = new URLSearchParams({ store_code: storeCode, month });
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/${apiBase}/sales/channels?${params}`);
    const json = await res.json();
    if (json.success) setChannels(json.data || []);
  }

  async function fetchTrend() {
    const params = new URLSearchParams({ store_code: storeCode });
    if (pureMode) params.set('pure_mode', 'true');
    const res = await fetch(`/api/${apiBase}/sales/trend?${params}`);
    const json = await res.json();
    if (json.success) setTrend(json.data);
  }

  const calcMoM = (current: number | null | undefined, prev: number | null | undefined): string | null => {
    if (!current || !prev || prev === 0) return null;
    const change = ((current - prev) / prev) * 100;
    return `${change >= 0 ? '↑' : '↓'} ${Math.abs(change).toFixed(1)}%`;
  };

  const currentStoreName = stores.find(s => s.store_code === storeCode)?.store_name || storeCode;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">{brandLabel} · 销售报表</h1>

      <div className="flex gap-3 flex-wrap">
        <select value={storeCode} onChange={e => setStoreCode(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm">
          {stores.map(s => <option key={s.store_code} value={s.store_code}>{s.store_name}</option>)}
        </select>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          className="border rounded px-3 py-1.5 text-sm" />
        {brand === 'gelatomiiix' && (
          <>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm">
              {PAYMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={pureMode} onChange={e => setPureMode(e.target.checked)}
                className="rounded border-gray-300" />
              纯净版
            </label>
          </>
        )}
      </div>

      {!storeCode && (
        <div className="text-center text-gray-400 py-12">暂无门店数据</div>
      )}

      {storeCode && kpi && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: '营业额', value: `¥${Number(kpi.gross_sales_amt).toLocaleString()}`, bg: 'bg-green-50', color: 'text-green-500', mom: prevMonth ? calcMoM(kpi.gross_sales_amt, prevMonth.gross_sales_amt) : null },
            { label: '营业收入', value: `¥${Number(kpi.revenue_amt).toLocaleString()}`, bg: 'bg-blue-50', color: 'text-blue-500', mom: null },
            { label: '订单数', value: kpi.order_cnt.toLocaleString(), bg: 'bg-yellow-50', color: 'text-yellow-600', mom: prevMonth ? calcMoM(kpi.order_cnt, prevMonth.order_cnt) : null },
            { label: '净收', value: `¥${Number(kpi.net_amt).toLocaleString()}`, bg: 'bg-purple-50', color: 'text-purple-600', mom: null },
          ].map((card, i) => (
            <div key={i} className={`${card.bg} rounded-lg p-4`}>
              <div className="text-xs text-gray-500">{card.label}</div>
              <div className="text-xl font-bold">{card.value}</div>
              {card.mom && <div className={`text-xs ${card.color}`}>{card.mom}</div>}
            </div>
          ))}
        </div>
      )}

      {storeCode && !kpi && daily.length === 0 && (
        <div className="text-center text-gray-400 py-8">暂无数据</div>
      )}

      <div className="flex gap-1 border-b">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Tab 1: 门店概览 */}
      {activeTab === 0 && (
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2 bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">日平均销售曲线 · {currentStoreName}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="biz_date" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="gross_sales_amt" name="营业额" stroke="#2563eb" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="revenue_amt" name="营业收入" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">支付渠道构成</h3>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={channels} dataKey="gross_amt" nameKey="payment_method" cx="50%" cy="50%" outerRadius={80} innerRadius={40}>
                  {channels.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab 2: 商品分析 */}
      {activeTab === 1 && products.by_sales.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">商品销售额 Top 10</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={products.by_sales.slice(0, 10)} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="product_name" tick={{ fontSize: 10 }} width={90} />
                <Tooltip />
                <Bar dataKey="total_received_amt" name="实收金额" fill="#2563eb" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3 text-sm">商品销量 Top 10</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={products.by_qty.slice(0, 10)} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="product_name" tick={{ fontSize: 10 }} width={90} />
                <Tooltip />
                <Bar dataKey="total_qty" name="销量" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tab 3: 支付渠道 */}
      {activeTab === 2 && (
        <div className="bg-white border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="text-left p-3 font-medium">支付渠道</th>
                <th className="text-right p-3 font-medium">金额</th>
                <th className="text-right p-3 font-medium">占比</th>
                <th className="text-right p-3 font-medium">笔数</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3">{ch.payment_method || '未知'}</td>
                  <td className="p-3 text-right">¥{ch.gross_amt.toLocaleString()}</td>
                  <td className="p-3 text-right">{ch.pct}%</td>
                  <td className="p-3 text-right">{ch.txn_cnt}</td>
                </tr>
              ))}
              {channels.length === 0 && (
                <tr><td colSpan={4} className="p-3 text-center text-gray-400">暂无数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 4: 月度趋势 */}
      {activeTab === 3 && trend.length > 0 && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-3 text-sm">最近12个月营业额 · 营业收入趋势 · {currentStoreName}</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(0, 7)} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="gross_sales_amt" name="营业额" stroke="#2563eb" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="revenue_amt" name="营业收入" stroke="#22c55e" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {activeTab === 3 && trend.length === 0 && (
        <div className="bg-white border rounded-lg p-8 text-center text-gray-400">
          暂无趋势数据
        </div>
      )}
    </div>
  );
}
