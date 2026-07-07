'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useBrand } from '@/lib/brand-context';
import {
    BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const CHART_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

// pg NUMERIC arrives as string; format for display
const fmtNum = (v: unknown, digits = 0): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtPct = (v: unknown, digits = 2): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${(n * (digits > 2 ? 1 : 1)).toFixed(digits)}%`;
};

interface ApiPayload<T> { success: boolean; data: T | null; error?: string; note?: string }
async function apiGet<T>(url: string): Promise<T | null> {
    const r = await fetch(url);
    const j: ApiPayload<T> = await r.json();
    if (!j.success || !j.data) return null;
    return j.data;
}

interface OverviewRow {
    store_code: string; month: string; gross_amt: string; revenue_amt: string;
    net_amt: string; discount_amt: string; qty: string; order_cnt: string;
    cash_in_rate: string; cash_in_rate_pct: string; profit_rate: string; avg_order_amt: string;
    prev_gross_amt: string | null; prev_revenue_amt: string | null;
    gross_mom_pct: string | null; revenue_mom_pct: string | null;
    order_cnt_mom_pct: string | null;
}
interface ChannelRow { store_code: string; month: string; order_source: string; gross_amt: string; revenue_amt: string; order_cnt: string; cash_in_rate: string }
interface DineRow { store_code: string; month: string; order_type: string; gross_amt: string; revenue_amt: string; order_cnt: string }
interface MealRow { store_code: string; month: string; meal_period: string; gross_amt: string; revenue_amt: string; order_cnt: string }
interface WeekdayRow { store_code: string; week_start: string; weekday: number; gross_amt: string; revenue_amt: string; order_cnt: string }
interface StoreRow { store_code: string; month: string; gross_amt: string; revenue_amt: string; order_cnt: string; gross_rank_in_month: number }

const WD_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

export default function TamkokoSalesPage() {
    const { brand } = useBrand();
    const [storeCode, setStoreCode] = useState('sh_sjh');
    const [month, setMonth] = useState('2026-06-01');
    const [error, setError] = useState<string | null>(null);

    const [overview, setOverview] = useState<OverviewRow[] | null>(null);
    const [channel, setChannel] = useState<ChannelRow[] | null>(null);
    const [dine, setDine] = useState<DineRow[] | null>(null);
    const [meal, setMeal] = useState<MealRow[] | null>(null);
    const [weekday, setWeekday] = useState<WeekdayRow[] | null>(null);
    const [multiStore, setMultiStore] = useState<StoreRow[] | null>(null);
    const [combinedDim1, setCombinedDim1] = useState<'order_source' | 'order_type' | 'meal_period' | 'weekday'>('order_source');
    const [combinedDim2, setCombinedDim2] = useState<'order_source' | 'order_type' | 'meal_period' | 'weekday'>('order_type');
    const [combined, setCombined] = useState<Array<Record<string, unknown>> | null>(null);

    const reload = async () => {
        setError(null);
        try {
            const base = `/api/tamkoko/sales`;
            const [o, ch, dt, mp, wd, ms, cb] = await Promise.all([
                apiGet<OverviewRow[]>(`${base}/overview?store=${storeCode}&month=${month}`),
                apiGet<ChannelRow[]>(`${base}/channel?store=${storeCode}&month=${month}`),
                apiGet<DineRow[]>(`${base}/dine-takeaway?store=${storeCode}&month=${month}`),
                apiGet<MealRow[]>(`${base}/meal-period?store=${storeCode}&month=${month}`),
                apiGet<WeekdayRow[]>(`${base}/weekday?store=${storeCode}`),
                apiGet<StoreRow[]>(`${base}/multi-store?month=${month}`),
                apiGet<Array<Record<string, unknown>>>(`${base}/combined?store=${storeCode}&month=${month}&dim1=${combinedDim1}&dim2=${combinedDim2}`),
            ]);
            setOverview(o); setChannel(ch); setDine(dt); setMeal(mp);
            setWeekday(wd); setMultiStore(ms); setCombined(cb);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'fetch failed');
        }
    };

    useEffect(() => { reload(); }, [storeCode, month, combinedDim1, combinedDim2]);

    const cur = overview?.[0];
    const kpis = cur ? [
        { label: '营业额',     value: fmtNum(cur.gross_amt, 2),    color: 'blue'   as const, mom: cur.gross_mom_pct },
        { label: '营业收入',   value: fmtNum(cur.revenue_amt, 2),  color: 'green'  as const, mom: cur.revenue_mom_pct },
        { label: '实收率',     value: fmtPct(cur.cash_in_rate_pct ?? Number(cur.cash_in_rate) * 100, 2), color: 'yellow' as const, mom: null },
        { label: '订单数',     value: fmtNum(cur.order_cnt),        color: 'purple' as const, mom: cur.order_cnt_mom_pct },
    ] : [];

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold">泰柯茶园 — 收银明细销售报表</h1>
                    <p className="text-sm text-gray-500 mt-1">8 维度分析(营业额 / 实收率 / 订单数 + 渠道 / 餐段 / 星期 / 多店 / 组合)</p>
                </div>
                <div className="flex gap-2 items-end">
                    <label className="text-xs">
                        <div className="text-gray-500 mb-1">门店</div>
                        <select className="border rounded px-2 py-1 text-sm" value={storeCode} onChange={e => setStoreCode(e.target.value)}>
                            <option value="sh_sjh">上海世纪汇店</option>
                            <option value="hz_fuyang">杭州富阳店</option>
                            <option value="wz_bjwxc">温州滨江万象城店</option>
                        </select>
                    </label>
                    <label className="text-xs">
                        <div className="text-gray-500 mb-1">月份</div>
                        <input className="border rounded px-2 py-1 text-sm" type="month" value={month.slice(0, 7)} onChange={e => setMonth(`${e.target.value}-01`)} />
                    </label>
                    <Link href="/u/sales/tamkoko/upload" className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">上传收银明细</Link>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">错误: {error}</div>}

            {/* 4 KPI cards */}
            <div className="grid grid-cols-4 gap-4">
                {kpis.map(k => (
                    <div key={k.label} className={`bg-${k.color}-50 rounded-lg p-4`}>
                        <div className="text-xs text-gray-500">{k.label}</div>
                        <div className="text-2xl font-bold mt-1">{k.value}</div>
                        {k.mom != null && Number.isFinite(Number(k.mom)) && (
                            <div className="text-xs text-gray-500 mt-1">环比 {Number(k.mom) >= 0 ? '↑' : '↓'} {fmtPct(Math.abs(Number(k.mom)), 2)}</div>
                        )}
                    </div>
                ))}
            </div>

            {/* 8 sections — each in a white card with title + chart or table */}
            <Section title="1. 渠道分布(订单来源)">
                {channel && channel.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <ResponsiveContainer width="100%" height={240}>
                            <PieChart>
                                <Pie data={channel} dataKey="gross_amt" nameKey="order_source" cx="50%" cy="50%" outerRadius={80} label={(e) => String((e as unknown as Record<string, unknown>)['order_source'] ?? '')}>
                                    {channel.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                </Pie>
                                <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            </PieChart>
                        </ResponsiveContainer>
                        <table className="w-full text-sm">
                            <thead><tr className="text-left text-gray-500"><th>渠道</th><th>订单数</th><th>营业额</th><th>实收率</th></tr></thead>
                            <tbody>
                                {channel.map(c => (
                                    <tr key={c.order_source} className="border-t">
                                        <td className="py-1">{c.order_source}</td>
                                        <td>{fmtNum(c.order_cnt)}</td>
                                        <td>{fmtNum(c.gross_amt, 2)}</td>
                                        <td>{fmtPct(Number(c.cash_in_rate) * 100, 2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty />}
            </Section>

            <Section title="2. 堂食 vs 外卖">
                {dine && dine.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={dine}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="order_type" />
                            <YAxis />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            <Bar dataKey="gross_amt" name="营业额" fill={CHART_COLORS[0]} />
                            <Bar dataKey="revenue_amt" name="营业收入" fill={CHART_COLORS[1]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : <Empty />}
            </Section>

            <Section title="3. 按餐段(早/午/晚市)">
                {meal && meal.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={meal}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="meal_period" />
                            <YAxis />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            <Bar dataKey="gross_amt" name="营业额" fill={CHART_COLORS[2]} />
                            <Bar dataKey="revenue_amt" name="营业收入" fill={CHART_COLORS[3]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : <Empty />}
            </Section>

            <Section title="4. 按星期几">
                {weekday && weekday.length > 0 ? (
                    <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={weekday.map(w => ({ ...w, wd_label: WD_LABEL[w.weekday] }))}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="wd_label" />
                            <YAxis />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            <Bar dataKey="gross_amt" name="营业额" fill={CHART_COLORS[4]} />
                        </BarChart>
                    </ResponsiveContainer>
                ) : <Empty />}
            </Section>

            <Section title="5. 多门店对比">
                {multiStore && multiStore.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500"><th>排名</th><th>门店</th><th>订单数</th><th>营业额</th><th>营业收入</th></tr></thead>
                        <tbody>
                            {multiStore.map(s => (
                                <tr key={s.store_code} className="border-t">
                                    <td className="py-1">{s.gross_rank_in_month ?? '-'}</td>
                                    <td>{s.store_code}</td>
                                    <td>{fmtNum(s.order_cnt)}</td>
                                    <td>{fmtNum(s.gross_amt, 2)}</td>
                                    <td>{fmtNum(s.revenue_amt, 2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <Empty />}
            </Section>

            <Section title="6. 多维组合">
                <div className="flex gap-2 mb-3 text-sm">
                    <label>维度1:
                        <select className="ml-1 border rounded px-1" value={combinedDim1} onChange={e => setCombinedDim1(e.target.value as typeof combinedDim1)}>
                            <option value="order_source">渠道</option>
                            <option value="order_type">堂食/外卖</option>
                            <option value="meal_period">餐段</option>
                            <option value="weekday">星期</option>
                        </select>
                    </label>
                    <label>维度2:
                        <select className="ml-1 border rounded px-1" value={combinedDim2} onChange={e => setCombinedDim2(e.target.value as typeof combinedDim2)}>
                            <option value="order_source">渠道</option>
                            <option value="order_type">堂食/外卖</option>
                            <option value="meal_period">餐段</option>
                            <option value="weekday">星期</option>
                        </select>
                    </label>
                </div>
                {combined && combined.length > 0 ? (
                    <table className="w-full text-sm">
                        <thead><tr className="text-left text-gray-500"><th>{combinedDim1}</th><th>{combinedDim2}</th><th>订单数</th><th>营业额</th></tr></thead>
                        <tbody>
                            {combined.map((row, i) => (
                                <tr key={i} className="border-t">
                                    <td className="py-1">{String(row['dim1_value'] ?? '')}</td>
                                    <td>{String(row['dim2_value'] ?? '')}</td>
                                    <td>{fmtNum(row['order_cnt'] as string)}</td>
                                    <td>{fmtNum(row['gross_amt'] as string, 2)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : <Empty />}
            </Section>

            <Section title="7. 收益率与客单价">
                {cur ? (
                    <div className="grid grid-cols-3 gap-4">
                        <Stat label="营业净收" value={fmtNum(cur.net_amt, 2)} />
                        <Stat label="收益率" value={fmtPct(Number(cur.profit_rate) * 100, 2)} />
                        <Stat label="客单价" value={fmtNum(cur.avg_order_amt, 2)} />
                    </div>
                ) : <Empty />}
            </Section>

            <Section title="8. 优惠分析">
                {cur ? (
                    <div className="grid grid-cols-3 gap-4">
                        <Stat label="优惠总额" value={fmtNum(cur.discount_amt, 2)} />
                        <Stat label="折扣率" value={fmtPct(Number(cur.discount_amt) / Number(cur.gross_amt || 1) * 100, 2)} />
                        <Stat label="销量(件)" value={fmtNum(cur.qty)} />
                    </div>
                ) : <Empty />}
            </Section>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="bg-white border rounded-lg p-4">
            <h3 className="font-semibold mb-3">{title}</h3>
            {children}
        </div>
    );
}

function Empty() {
    return <div className="text-sm text-gray-400 py-4 text-center">暂无数据</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="border rounded p-3">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-lg font-semibold mt-1">{value}</div>
        </div>
    );
}