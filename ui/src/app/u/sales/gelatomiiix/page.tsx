'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell,
    ScatterChart, Scatter,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { STORES } from '../tamkoko/stores';

const CHART_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const fmtNum = (v: unknown, digits = 0): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtPct = (v: unknown, digits = 2): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(digits)}%`;
};

async function apiGet<T>(url: string): Promise<T | null> {
    const r = await fetch(url);
    const j: { success: boolean; data: T | null } = await r.json();
    if (!j.success || !j.data) return null;
    return j.data;
}

interface OverviewRow {
    store_code: string; month: string;
    gross_amt: string; revenue_amt: string; discount_amt: string; net_amt: string;
    order_cnt: string; cash_in_rate: string; avg_order_amt: string;
    cash_in_rate_pct: string; discount_rate_pct: string;
    prev_gross_amt?: string; prev_revenue_amt?: string; prev_order_cnt?: string;
    gross_mom_pct?: string; revenue_mom_pct?: string; order_cnt_mom_pct?: string;
}
interface DailyRow {
    store_code: string; biz_date: string;
    gross_amt: string; revenue_amt: string; order_cnt: string; cash_in_rate_pct: string;
}
interface ChannelRow {
    store_code: string; month: string; channel: string;
    gross_amt: string; revenue_amt: string; order_cnt: string; cash_in_rate_pct: string;
}
interface DineRow {
    store_code: string; month: string; order_type: string;
    gross_amt: string; revenue_amt: string; order_cnt: string;
}
interface ProductRow {
    store_code: string; month: string; product_name: string;
    total_qty: string; total_received: string; total_sales: string;
}
interface ChannelDailyRow {
    store_code: string; biz_date: string; channel: string;
    gross_amt: string; revenue_amt: string; order_cnt: string;
}
interface ProductAnalysisRow {
    spec_level1?: string; spec_level2?: string; product_name?: string; unit_price?: string; total_qty: string;
    total_sales: string; total_received: string; total_discount: string; cash_in_rate_pct: string;
    product_count?: string;
}
interface HourlyRow {
    order_hour: string; order_cnt: string; total_qty: string; total_sales: string; total_received: string;
}


interface StoreRow { store_code: string; store_name: string; }

export default function GelatomiiixSalesPage() {
    const [stores, setStores] = useState<StoreRow[]>([]);
    const [storeCode, setStoreCode] = useState('sh_xtd');
    const [month, setMonth] = useState(() => {
        // default to previous month (current month may not have data yet)
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    });
    const [selectedDrillMonth, setSelectedDrillMonth] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [overview, setOverview] = useState<OverviewRow | null>(null);
    const [daily, setDaily] = useState<DailyRow[] | null>(null);
    const [channel, setChannel] = useState<ChannelRow[] | null>(null);
    const [dine, setDine] = useState<DineRow[] | null>(null);
    const [products, setProducts] = useState<ProductRow[] | null>(null);
    const [trend, setTrend] = useState<OverviewRow[] | null>(null);
    const [channelDaily, setChannelDaily] = useState<ChannelDailyRow[] | null>(null);
    const [productAnalysis, setProductAnalysis] = useState<ProductAnalysisRow[] | null>(null);
    const [specAnalysis, setSpecAnalysis] = useState<ProductAnalysisRow[] | null>(null);
    const [hourly, setHourly] = useState<HourlyRow[] | null>(null);
    const [channelTrend, setChannelTrend] = useState<ChannelRow[] | null>(null);
    const [pureMode, setPureMode] = useState(false);
    const [categoryData, setCategoryData] = useState<any[] | null>(null);
    const [cupData, setCupData] = useState<any[] | null>(null);
    const [channelDailyMetric, setChannelDailyMetric] = useState<'gross_amt' | 'revenue_amt' | 'order_cnt'>('gross_amt');

    const reloadMonthly = async () => {
        setError(null);
        try {
            const base = '/api/gelatomiiix/sales';
            const storeQs = `store=${storeCode}&`;
            const extra = pureMode ? '&exclude_other=true' : '';
            const [o, ch, dt, pd, tr, cd, pa, sp, hr, ct, cc] = await Promise.all([
                apiGet<OverviewRow[]>(`${base}/overview?${storeQs}month=${month}${extra}`),
                apiGet<ChannelRow[]>(`${base}/channel?${storeQs}month=${month}${extra}`),
                apiGet<DineRow[]>(`${base}/dine-takeaway?${storeQs}month=${month}${extra}`),
                apiGet<ProductRow[]>(`${base}/product?${storeQs}month=${month}${extra}`),
                apiGet<OverviewRow[]>(`${base}/trend?${storeQs}${extra}`),
                apiGet<ChannelDailyRow[]>(`${base}/channel-daily?${storeQs}month=${month}${extra}`),
                apiGet<ProductAnalysisRow[]>(`${base}/product-analysis?${storeQs}month=${month}${extra}`),
                apiGet<ProductAnalysisRow[]>(`${base}/product-analysis?${storeQs}month=${month}&group_by=spec${extra}`),
                apiGet<HourlyRow[]>(`${base}/hourly?${storeQs}month=${month}${extra}`),
                apiGet<ChannelRow[]>(`${base}/channel?${storeQs}${extra}`),
                apiGet<any>(`${base}/category-cup?${storeQs}month=${month}`),
            ]);
            setOverview(o?.[0] ?? null);
            setChannel(ch ?? null);
            setDine(dt ?? null);
            setProducts(pd ?? null);
            setTrend(tr ?? null);
            setChannelDaily(cd ?? null);
            setProductAnalysis(pa ?? null);
            setSpecAnalysis(sp ?? null);
            setHourly(hr ?? null);
            setChannelTrend(ct ?? null);
            if (cc) { setCategoryData(cc.categories ?? null); setCupData(cc.cups ?? null); }
        } catch (e) {
            setError(e instanceof Error ? e.message : 'fetch failed');
        }
    };

    const reloadDaily = async (drillMonth: string) => {
        try {
            const extra = pureMode ? '&exclude_other=true' : '';
            const d = await apiGet<DailyRow[]>(`/api/gelatomiiix/sales/daily?store=${storeCode}&month=${drillMonth}${extra}`);
            setDaily(d ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'fetch daily failed');
        }
    };

    useEffect(() => {
        fetch('/api/stores?brand=gelatomiiix')
            .then(r => r.json())
            .then(json => { if (json.success && json.data?.length) setStores(json.data); })
            .catch(() => {});
    }, []);

    useEffect(() => { reloadMonthly(); }, [month, pureMode, storeCode]);
    useEffect(() => {
        if (selectedDrillMonth) reloadDaily(selectedDrillMonth);
    }, [selectedDrillMonth]);

    // 5 KPI cards
    const cur = overview;
    const kpis = cur ? [
        { label: '营业额', value: fmtNum(cur.gross_amt, 2),          key: 'gross_amt',   mom: cur.gross_mom_pct ? `${Number(cur.gross_mom_pct)>=0?'↑':'↓'}${Math.abs(Number(cur.gross_mom_pct)).toFixed(1)}%` : null },
        { label: '营业收入', value: fmtNum(cur.revenue_amt, 2),       key: 'revenue_amt', mom: cur.revenue_mom_pct ? `${Number(cur.revenue_mom_pct)>=0?'↑':'↓'}${Math.abs(Number(cur.revenue_mom_pct)).toFixed(1)}%` : null },
        { label: '实收率',   value: fmtPct(cur.cash_in_rate_pct, 2),  key: 'cash_in_rate_pct' },
        { label: '订单数',   value: fmtNum(cur.order_cnt),            key: 'order_cnt',   mom: cur.order_cnt_mom_pct ? `${Number(cur.order_cnt_mom_pct)>=0?'↑':'↓'}${Math.abs(Number(cur.order_cnt_mom_pct)).toFixed(1)}%` : null },
        { label: '客单价',   value: fmtNum(cur.avg_order_amt, 2),     key: 'avg_order_amt' },
    ] : [];

    // Trend with fixed 12-month X axis
    const trendData: Array<{ month: string; gross_amt: number; revenue_amt: number; order_cnt: number; cash_in_rate: number; avg_order_amt: number }> = (() => {
        const months: string[] = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const byMonth = new Map<string, OverviewRow>();
        for (const t of (trend ?? [])) {
            const m = String(t.month).slice(0, 7);
            byMonth.set(m, t);
        }
        return months.map(m => {
            const row = byMonth.get(m);
            return {
                month: m,
                gross_amt: row ? Number(row.gross_amt) || 0 : 0,
                revenue_amt: row ? Number(row.revenue_amt) || 0 : 0,
                order_cnt: row ? Number(row.order_cnt) || 0 : 0,
                cash_in_rate: row ? Number(row.cash_in_rate_pct) || 0 : 0,
                avg_order_amt: row ? Number(row.avg_order_amt) || 0 : 0,
            };
        });
    })();

    const dailyData = (daily ?? []).map(d => ({
        date: String(d.biz_date).slice(8, 10) + '日',
        gross_amt: Number(d.gross_amt),
        revenue_amt: Number(d.revenue_amt),
        order_cnt: Number(d.order_cnt),
    }));

    const productsBySales = (products ?? []).slice(0, 10).map(p => ({
        product_name: p.product_name,
        total_received: Number(p.total_received),
        total_qty: Number(p.total_qty),
    }));

    const storeName = stores.find(s => s.store_code === storeCode)?.store_name || storeCode;

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold">蜜可诗 — 销售报表</h1>
                    <p className="text-sm text-gray-500 mt-1">12 月趋势 + KPI drill-down + 多维度分析</p>
                </div>
                <div className="flex items-end gap-4">
                    <label className="text-xs">
                        <div className="text-gray-500 mb-1">门店</div>
                        <select className="border rounded px-2 py-1 text-sm" value={storeCode} onChange={e => { setStoreCode(e.target.value); setSelectedDrillMonth(null); }}>
                            {stores.map(s => <option key={s.store_code} value={s.store_code}>{s.store_name}</option>)}
                        </select>
                    </label>
                    <label className="text-xs">
                        <div className="text-gray-500 mb-1">月份</div>
                        <input className="border rounded px-2 py-1 text-sm" type="month" value={month.slice(0, 7)}
                            onChange={e => { setMonth(`${e.target.value}-01`); setSelectedDrillMonth(null); }} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none pb-0.5">
                        <input type="checkbox" checked={pureMode} onChange={e => setPureMode(e.target.checked)} className="rounded" />
                        纯净模式
                    </label>
                    <Link href={`/u/sales/gelatomiiix/discount?store=${storeCode}`}
                       className="text-xs px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-600 rounded border border-purple-200 transition-colors"
                       title="查看折扣率分析">
                        折扣分析
                    </Link>
                    <a href="/admin/upload?source=product_sales"
                       className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded border border-blue-200 transition-colors"
                       title="上传商品销售明细 CSV 数据">
                        上传商品销售
                    </a>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">错误: {error}</div>}

            {/* 5 KPI cards */}
            <div className="grid grid-cols-5 gap-4">
                {kpis.map(k => (
                    <div key={k.label} className={`rounded-lg p-4 ${k.label === '营业额' ? 'bg-green-50' : k.label === '营业收入' ? 'bg-blue-50' : k.label === '实收率' ? 'bg-yellow-50' : k.label === '订单数' ? 'bg-purple-50' : 'bg-pink-50'}`}>
                        <div className="text-xs text-gray-500">{k.label}</div>
                        <div className="text-2xl font-bold mt-1">{k.value}</div>
                        {k.mom && <div className="text-xs mt-1 text-gray-600">{k.mom}</div>}
                    </div>
                ))}
            </div>

            {/* Trend section with drill-down */}
            <Section
                title={selectedDrillMonth ? `${selectedDrillMonth.slice(0, 7)} 日级趋势 · ${storeName}` : '12 月趋势 · ' + storeName + '(点击某月查看日级)'}
                action={selectedDrillMonth ? (
                    <button onClick={() => setSelectedDrillMonth(null)}
                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded">
                        ← 返回月级
                    </button>
                ) : null}
            >
                {!selectedDrillMonth ? (<>
                    <div>
                        <div className="text-xs text-gray-500 mb-1">营业额/营业收入(线) + 实收率(柱,0-100%)</div>
                        <ResponsiveContainer width="100%" height={260}>
                            <ComposedChart data={trendData} onClick={(e: { activeLabel?: string | number }) => {
                                if (e?.activeLabel != null) {
                                    const label = String(e.activeLabel);
                                    const found = trendData.find(d => d.month === label);
                                    if (found && found.gross_amt > 0) setSelectedDrillMonth(label + '-01');
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" interval={0} />
                                <YAxis yAxisId="left" tickFormatter={(v: number) => fmtNum(v, 0)} width={80} />
                                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={50} />
                                <Tooltip formatter={(v: unknown, name?: string | number) => name === '实收率(%)' ? fmtPct(Number(v), 2) : fmtNum(v, 2)} />
                                <Legend />
                                <Bar yAxisId="right" dataKey="cash_in_rate" name="实收率(%)" fill={CHART_COLORS[2]} />
                                <Line yAxisId="left" type="monotone" dataKey="gross_amt" name="营业额" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                <Line yAxisId="left" type="monotone" dataKey="revenue_amt" name="营业收入" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    <div>
                        <div className="text-xs text-gray-500 mb-1">订单数(左) + 客单价(右,元)</div>
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={trendData} onClick={(e: { activeLabel?: string | number }) => {
                                if (e?.activeLabel != null) {
                                    const found = trendData.find(d => d.month === String(e.activeLabel));
                                    if (found && found.order_cnt > 0) setSelectedDrillMonth(String(e.activeLabel) + '-01');
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" interval={0} />
                                <YAxis yAxisId="left" tickFormatter={(v: number) => fmtNum(v, 0)} width={70} />
                                <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmtNum(v, 2)} width={70} />
                                <Tooltip formatter={(v: unknown, name?: string | number) => name === '客单价' ? fmtNum(Number(v), 2) : fmtNum(v, 0)} />
                                <Legend />
                                <Line yAxisId="left" type="monotone" dataKey="order_cnt" name="订单数" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                <Line yAxisId="right" type="monotone" dataKey="avg_order_amt" name="客单价" stroke={CHART_COLORS[5]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                    {/* 渠道月趋势 */}
                    {channelTrend && channelTrend.length > 0 && (() => {
                        const chMonths = Array.from(new Set(channelTrend.map(c => String(c.month).slice(0, 7)))).sort().slice(-12);
                        const channels = Array.from(new Set(channelTrend.map(c => c.channel))).filter(c => c !== '其他' && c !== '');
                        const chData = chMonths.map(m => {
                            const row: Record<string, unknown> = { month: m };
                            for (const ch of channels) {
                                const match = channelTrend.find(c => String(c.month).slice(0, 7) === m && c.channel === ch);
                                row[ch] = match ? Number(match.gross_amt) : 0;
                            }
                            return row;
                        });
                        return (
                            <div className="mt-4">
                                <div className="text-xs text-gray-500 mb-1">各渠道月度营业额趋势(堆叠)</div>
                                <ResponsiveContainer width="100%" height={220}>
                                    <BarChart data={chData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="month" interval={0} tick={{ fontSize: 10 }} />
                                        <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                        <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                        <Legend />
                                        {channels.map((c, i) => <Bar key={c} dataKey={c} name={c} fill={CHART_COLORS[i % CHART_COLORS.length]} stackId="a" />)}
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        );
                    })()}
                </>) : (<>
                    <div className="text-xs text-gray-500 mb-1">月内日级趋势(左轴:金额/订单数)</div>
                    <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={dailyData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" interval={0} />
                            <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            <Line type="monotone" dataKey="gross_amt" name="营业额" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="revenue_amt" name="营业收入" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} />
                            <Line type="monotone" dataKey="order_cnt" name="订单数" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </>)}
            </Section>

            {/* 1. 渠道分布 */}
            <Section title="1. 渠道分布(支付方式)">
                {channel && channel.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="min-w-0">
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie data={channel.map(c => ({ channel: c.channel, gross_amt: Number(c.gross_amt) }))}
                                        dataKey="gross_amt" nameKey="channel" cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                                        label={({ cx, cy, x, y, payload }: { cx?: number; cy?: number; x?: number; y?: number; payload?: { channel?: string; gross_amt?: number } }) =>
                                            `${payload?.channel ?? ''} ¥${fmtNum(payload?.gross_amt, 0)}`}
                                        labelLine={true}>
                                        {channel.map((c, i) => <Cell key={c.channel} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-gray-500"><th>渠道</th><th>订单数</th><th>营业额</th><th>实收率</th></tr></thead>
                            <tbody>
                                {channel.map(c => (
                                    <tr key={c.channel} className="border-t">
                                        <td className="py-1">{c.channel}</td>
                                        <td>{fmtNum(c.order_cnt)}</td>
                                        <td>¥{fmtNum(c.gross_amt, 2)}</td>
                                        <td>{fmtPct(c.cash_in_rate_pct, 2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 2. 堂食 vs 打包 */}
            <Section title="2. 堂食 vs 打包">
                {dine && dine.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="min-w-0">
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie data={dine.map(d => ({ order_type: d.order_type, gross_amt: Number(d.gross_amt) }))}
                                        dataKey="gross_amt" nameKey="order_type" cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                                        label={({ payload }: { payload?: { order_type?: string; gross_amt?: number } }) =>
                                            `${payload?.order_type ?? ''} ¥${fmtNum(payload?.gross_amt, 0)}`}
                                        labelLine={true}>
                                        {dine.map((d, i) => <Cell key={d.order_type} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-gray-500"><th>类型</th><th>订单数</th><th>营业额</th><th>营业收入</th></tr></thead>
                            <tbody>
                                {dine.map(d => (
                                    <tr key={d.order_type} className="border-t">
                                        <td className="py-1">{d.order_type}</td>
                                        <td>{fmtNum(d.order_cnt)}</td>
                                        <td>¥{fmtNum(d.gross_amt, 2)}</td>
                                        <td>¥{fmtNum(d.revenue_amt, 2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 3. 商品排行 */}
            <Section title="3. 商品排行 Top 10">
                {productsBySales.length > 0 ? (
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-xs text-gray-500 mb-2">按实收金额</h4>
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={productsBySales} layout="vertical" margin={{ left: 100 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtNum(v, 0)} />
                                    <YAxis type="category" dataKey="product_name" tick={{ fontSize: 10 }} width={90} />
                                    <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                    <Bar dataKey="total_received" name="实收金额" fill="#2563eb" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                        <div>
                            <h4 className="text-xs text-gray-500 mb-2">按销量</h4>
                            <ResponsiveContainer width="100%" height={260}>
                                <BarChart data={productsBySales} layout="vertical" margin={{ left: 100 }}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} />
                                    <YAxis type="category" dataKey="product_name" tick={{ fontSize: 10 }} width={90} />
                                    <Tooltip />
                                    <Bar dataKey="total_qty" name="销量" fill="#22c55e" />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 4. 支付方式日趋势 */}
            <Section title="4. 支付方式日趋势" action={
                <select className="text-xs border rounded px-1 py-0.5" value={channelDailyMetric}
                    onChange={e => setChannelDailyMetric(e.target.value as 'gross_amt' | 'revenue_amt' | 'order_cnt')}>
                    <option value="gross_amt">营业额</option>
                    <option value="revenue_amt">营业收入</option>
                    <option value="order_cnt">单量</option>
                </select>
            }>
                {channelDaily && channelDaily.length > 0 ? (() => {
                    const days = Array.from(new Set(channelDaily.map(d => String(d.biz_date)))).sort();
                    const channels = Array.from(new Set(channelDaily.map(d => d.channel)))
                        .filter(c => c !== '其他' && c !== '');
                    const data = days.map(day => {
                        const row: Record<string, unknown> = { day: day.slice(8, 10) + '日' };
                        for (const c of channels) {
                            const match = channelDaily.find(d => String(d.biz_date) === day && d.channel === c);
                            row[c] = match ? Number(match[channelDailyMetric]) : 0;
                        }
                        return row;
                    });
                    return (
                        <div>
                            <div className="text-xs text-gray-500 mb-2">当月每日各支付方式 {channelDailyMetric === 'gross_amt' ? '营业额' : channelDailyMetric === 'revenue_amt' ? '营业收入' : '单量'} 趋势</div>
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={data}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="day" interval={0} tick={{ fontSize: 10 }} />
                                    <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                    <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                    <Legend />
                                    {channels.map((c, i) => (
                                        <Line key={c} type="monotone" dataKey={c} name={c}
                                            stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                            strokeWidth={2} dot={false} connectNulls />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    );
                })() : <Empty />}
            </Section>

            {/* 5. 规格分析 */}
            <Section title="5. 规格分析">
                {specAnalysis && specAnalysis.length > 0 ? (
                    <div className="space-y-1">
                        {/* 规格饼图 */}
                        <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Pie data={specAnalysis.map(s => ({ spec: s.spec_level1, value: Number(s.total_sales) }))}
                                        dataKey="value" nameKey="spec" cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                                        label={({ payload }: { payload?: { spec?: string; value?: number } }) =>
                                            `${payload?.spec ?? ''} ¥${fmtNum(payload?.value, 0)}`}
                                        labelLine={true}>
                                    {specAnalysis.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                        {/* 规格明细表 */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-gray-500 border-b">
                                    <th className="p-1.5">一级规格</th>
                                    <th className="p-1.5">二级规格</th>
                                    <th className="p-1.5 text-right">销量</th>
                                    <th className="p-1.5 text-right">销售额</th>
                                    <th className="p-1.5 text-right">实收</th>
                                    <th className="p-1.5 text-right">折扣</th>
                                    <th className="p-1.5 text-right">实收率</th>
                                </tr></thead>
                                <tbody>
                                    {specAnalysis.map((s, i) => (
                                        <tr key={i} className="border-t hover:bg-gray-50">
                                            <td className="p-1.5 font-medium">{s.spec_level1}</td>
                                            <td className="p-1.5 text-gray-500">{s.spec_level2}</td>
                                            <td className="p-1.5 text-right">{fmtNum(s.total_qty)}</td>
                                            <td className="p-1.5 text-right">¥{fmtNum(s.total_sales, 2)}</td>
                                            <td className="p-1.5 text-right">¥{fmtNum(s.total_received, 2)}</td>
                                            <td className="p-1.5 text-right text-red-500">¥{fmtNum(s.total_discount, 2)}</td>
                                            <td className="p-1.5 text-right">{fmtPct(s.cash_in_rate_pct, 2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 6. 品类健康度 */}
            <Section title="6. 品类健康度">
                {categoryData && categoryData.length > 0 ? (
                    <div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead><tr className="text-left text-gray-500 border-b">
                                    <th className="p-1.5">品类</th>
                                    <th className="p-1.5 text-right">SKU数</th>
                                    <th className="p-1.5 text-right">销量占比</th>
                                    <th className="p-1.5 text-right">销售额</th>
                                    <th className="p-1.5 text-right">折扣率</th>
                                    <th className="p-1.5 text-right">实收率</th>
                                    <th className="p-1.5 text-right">均价</th>
                                </tr></thead>
                                <tbody>
                                    {categoryData.map((c: any, i: number) => (
                                        <tr key={c.category} className="border-t hover:bg-gray-50">
                                            <td className="p-1.5 font-medium">{c.category}</td>
                                            <td className="p-1.5 text-right">{c.sku_cnt}</td>
                                            <td className="p-1.5 text-right">{fmtPct(c.qty_share_pct)}</td>
                                            <td className="p-1.5 text-right">¥{fmtNum(c.total_sales)}</td>
                                            <td className="p-1.5 text-right text-red-500">{fmtPct(c.disc_rate_pct)}</td>
                                            <td className="p-1.5 text-right">{fmtPct(c.cash_in_rate_pct)}</td>
                                            <td className="p-1.5 text-right">¥{c.avg_price}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 7. 杯型 × 折扣 */}
            <Section title="7. 杯型折扣分析">
                {cupData && cupData.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-gray-500 border-b">
                                <th className="p-1.5">杯型</th>
                                <th className="p-1.5 text-right">总销量</th>
                                <th className="p-1.5 text-right">有折扣行数</th>
                                <th className="p-1.5 text-right">折扣率</th>
                                <th className="p-1.5 text-right">均价</th>
                                <th className="p-1.5 text-right">销售额</th>
                            </tr></thead>
                            <tbody>
                                {cupData.map((c: any) => (
                                    <tr key={c.cup_type} className="border-t hover:bg-gray-50">
                                        <td className="p-1.5 font-medium">{c.cup_type}</td>
                                        <td className="p-1.5 text-right">{fmtNum(c.total_qty)}</td>
                                        <td className="p-1.5 text-right">{fmtNum(c.disc_lines)}</td>
                                        <td className="p-1.5 text-right text-red-500">{fmtPct(c.disc_rate_pct)}</td>
                                        <td className="p-1.5 text-right">¥{c.avg_price}</td>
                                        <td className="p-1.5 text-right">¥{fmtNum(c.total_sales)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 8. 小时分析 */}
            <Section title="8. 时段销售分析">
                {hourly && hourly.length > 0 ? (
                    <div>
                        <div className="text-xs text-gray-500 mb-2">各时段订单数/销售额 + 折扣率</div>
                        <ResponsiveContainer width="100%" height={260}>
                            <ComposedChart data={hourly.map(h => ({
                                hour: h.order_hour,
                                orders: Number(h.order_cnt),
                                sales: Number(h.total_sales),
                                discRate: Number((h as any).disc_rate_pct ?? 0),
                            }))}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="hour" interval={0} tick={{ fontSize: 10 }} />
                                <YAxis yAxisId="left" tickFormatter={(v: number) => fmtNum(v, 0)} />
                                <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => `${v}%`} domain={[0, 'auto']} />
                                <Tooltip formatter={(v: unknown, name: unknown) =>
                                    String(name ?? '') === '折扣率' ? fmtPct(v) : fmtNum(v, 2)} />
                                <Legend />
                                <Bar yAxisId="left" dataKey="orders" name="订单数" fill={CHART_COLORS[3]} radius={[3, 3, 0, 0]} />
                                <Bar yAxisId="left" dataKey="sales" name="销售额" fill={CHART_COLORS[0]} radius={[3, 3, 0, 0]} />
                                <Line yAxisId="right" dataKey="discRate" name="折扣率" stroke={CHART_COLORS[2]} strokeWidth={2} dot={{ r: 3 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                ) : <Empty />}
            </Section>
        </div>
    );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="bg-white border rounded-lg p-4">
            <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold">{title}</h3>
                {action}
            </div>
            {children}
        </div>
    );
}

function Empty() {
    return <div className="text-sm text-gray-400 py-4 text-center">暂无数据</div>;
}
