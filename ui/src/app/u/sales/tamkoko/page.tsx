'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
    BarChart, Bar, LineChart, Line, ComposedChart, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

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
    store_code: string; month: string; gross_amt: string; revenue_amt: string;
    net_amt: string; discount_amt: string; qty: string; order_cnt: string;
    cash_in_rate: string; profit_rate: string; avg_order_amt: string;
    cash_in_rate_pct: string; prev_gross_amt: string | null;
}
interface DailyRow {
    store_code: string; biz_date: string; gross_amt: string; revenue_amt: string;
    order_cnt: string; cash_in_rate_pct: string;
}
interface ChannelRow {
    store_code: string; month: string; order_source: string; gross_amt: string;
    revenue_amt: string; order_cnt: string; cash_in_rate: string;
}
interface DineRow {
    store_code: string; month: string; order_type: string; gross_amt: string;
    revenue_amt: string; order_cnt: string;
}
interface MealRow {
    store_code: string; month: string; meal_period: string; gross_amt: string;
    revenue_amt: string; order_cnt: string;
}

const MEAL_PERIOD_LABELS: Record<string, string> = {
    '早市': '06:00-10:59',
    '午市': '11:00-16:59',
    '晚市': '17:00-21:59',
    '未分类': '其他',
};
type MealMetric = 'gross_amt' | 'revenue_amt' | 'dine_takeaway';

export default function TamkokoSalesPage() {
    const [storeCode, setStoreCode] = useState('sh_sjh');
    const [month, setMonth] = useState('2026-06-01');
    const [selectedDrillMonth, setSelectedDrillMonth] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [overview, setOverview] = useState<OverviewRow[] | null>(null);
    const [trend, setTrend] = useState<OverviewRow[] | null>(null);
    const [daily, setDaily] = useState<DailyRow[] | null>(null);
    const [channel, setChannel] = useState<ChannelRow[] | null>(null);
    const [channelTrend, setChannelTrend] = useState<ChannelRow[] | null>(null);
    const [dine, setDine] = useState<DineRow[] | null>(null);
    const [meal, setMeal] = useState<MealRow[] | null>(null);
    const [mealMetric, setMealMetric] = useState<MealMetric>('gross_amt');

    const reloadMonthly = async () => {
        setError(null);
        try {
            const base = `/api/tamkoko/sales`;
            const [o, t, ch, dt, mp, ct] = await Promise.all([
                apiGet<OverviewRow[]>(`${base}/overview?store=${storeCode}&month=${month}`),
                apiGet<OverviewRow[]>(`${base}/trend?store=${storeCode}&months=12`),
                apiGet<ChannelRow[]>(`${base}/channel?store=${storeCode}&month=${month}`),
                apiGet<DineRow[]>(`${base}/dine-takeaway?store=${storeCode}&month=${month}`),
                apiGet<MealRow[]>(`${base}/meal-period?store=${storeCode}&month=${month}`),
                apiGet<ChannelRow[]>(`${base}/channel?store=${storeCode}`), // 12 月 channel trend(全月)
            ]);
            setOverview(o ?? null);
            setTrend(t ?? null);
            setChannel(ch ?? null);
            setDine(dt ?? null);
            setMeal(mp ?? null);
            setChannelTrend(ct ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'fetch failed');
        }
    };

    const reloadDaily = async (drillMonth: string) => {
        try {
            const d = await apiGet<DailyRow[]>(`/api/tamkoko/sales/daily?store=${storeCode}&month=${drillMonth}`);
            setDaily(d ?? null);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'fetch daily failed');
        }
    };

    useEffect(() => { reloadMonthly(); }, [storeCode, month]);
    useEffect(() => {
        if (selectedDrillMonth) reloadDaily(selectedDrillMonth);
    }, [storeCode, selectedDrillMonth]);

    // 5 KPI
    const cur = overview?.[0];
    const kpis = cur ? [
        { label: '营业额',   value: fmtNum(cur.gross_amt, 2),    color: 'blue'   as const, key: 'gross_amt'   as const },
        { label: '营业收入', value: fmtNum(cur.revenue_amt, 2),  color: 'green'  as const, key: 'revenue_amt' as const },
        { label: '实收率',   value: fmtPct(cur.cash_in_rate_pct ?? Number(cur.cash_in_rate) * 100, 2), color: 'yellow' as const, key: 'cash_in_rate_pct' as const },
        { label: '订单数',   value: fmtNum(cur.order_cnt),        color: 'purple' as const, key: 'order_cnt'   as const },
        { label: '客单价',   value: fmtNum(cur.avg_order_amt, 2), color: 'pink'   as const, key: 'avg_order_amt' as const },
    ] : [];

    // 趋势折线:始终生成最近 12 个月的 X 轴,空月填 0(避免布局抖动)
    const trendData: Array<{ month: string; gross_amt: number; revenue_amt: number; order_cnt: number; cash_in_rate: number; avg_order_amt: number }> = (() => {
        const months: string[] = [];
        const now = new Date();
        // 从 11 个月前到当前月,共 12 个
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const byMonth = new Map<string, { gross_amt: number; revenue_amt: number; order_cnt: number; cash_in_rate: number; avg_order_amt: number }>();
        for (const t of (trend ?? [])) {
            const m = String(t.month).slice(0, 7);
            const gross = Number(t.gross_amt) || 0;
            const orderCnt = Number(t.order_cnt) || 0;
            byMonth.set(m, {
                gross_amt: gross,
                revenue_amt: Number(t.revenue_amt) || 0,
                order_cnt: orderCnt,
                cash_in_rate: (Number(t.cash_in_rate) || 0) * 100,
                avg_order_amt: orderCnt > 0 ? gross / orderCnt : 0,
            });
        }
        return months.map(m => {
            const row = byMonth.get(m);
            return {
                month: m,
                gross_amt: row?.gross_amt ?? 0,
                revenue_amt: row?.revenue_amt ?? 0,
                order_cnt: row?.order_cnt ?? 0,
                cash_in_rate: row?.cash_in_rate ?? 0,
                avg_order_amt: row?.avg_order_amt ?? 0,
            };
        });
    })();

    // 渠道 12 月趋势:按月 × order_source 矩阵
    const channelMonths = Array.from(new Set((channelTrend ?? []).map(c => String(c.month).slice(0, 7)))).sort();
    const channelSources = Array.from(new Set((channelTrend ?? []).map(c => c.order_source)));
    const channelTrendData = channelMonths.map(m => {
        const row: Record<string, string | number> = { month: m };
        for (const s of channelSources) {
            const r = (channelTrend ?? []).find(c => String(c.month).slice(0, 7) === m && c.order_source === s);
            row[s] = r ? Number(r.gross_amt) : 0;
        }
        return row;
    });

    // 日级 drill-down
    const dailyData = (daily ?? []).map(d => ({
        date: String(d.biz_date).slice(8, 10) + '日',
        gross_amt: Number(d.gross_amt),
        revenue_amt: Number(d.revenue_amt),
        order_cnt: Number(d.order_cnt),
    }));

    // meal-period 数据按 metric 切换
    const mealChartData = (() => {
        if (!meal) return [];
        if (mealMetric === 'dine_takeaway') {
            // 从 dine 视图取该月数据(每个 meal_period 对应堂食/外卖数)
            return dine ? dine.map(d => ({
                name: d.order_type,
                value: Number(d.gross_amt),
            })) : [];
        }
        return meal.map(m => ({
            meal_period: m.meal_period,
            [mealMetric]: Number(m[mealMetric]),
        }));
    })();

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold">泰柯茶园 — 收银明细销售报表</h1>
                    <p className="text-sm text-gray-500 mt-1">12 月趋势 + KPI drill-down + 5 维度分析</p>
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
                        <div className="text-gray-500 mb-1">月份(顶部 KPI)</div>
                        <input className="border rounded px-2 py-1 text-sm" type="month" value={month.slice(0, 7)} onChange={e => { setMonth(`${e.target.value}-01`); setSelectedDrillMonth(null); }} />
                    </label>
                    <Link href="/u/sales/tamkoko/upload" className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">上传收银明细</Link>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">错误: {error}</div>}

            {/* 5 KPI cards */}
            <div className="grid grid-cols-5 gap-4" data-testid="kpi-grid">
                {kpis.map(k => (
                    <div key={k.label} data-testid={`kpi-card-${k.label}`} className={`bg-${k.color}-50 rounded-lg p-4`}>
                        <div className="text-xs text-gray-500">{k.label}</div>
                        <div className="text-2xl font-bold mt-1">{k.value}</div>
                    </div>
                ))}
            </div>

            {/* 顶部 12 月趋势 + drill-down 切换 */}
            <Section
                title={selectedDrillMonth ? `${selectedDrillMonth.slice(0, 7)} 日级趋势` : '12 月趋势(点击某月查看日级)'}
                action={
                    selectedDrillMonth ? (
                        <button
                            onClick={() => setSelectedDrillMonth(null)}
                            className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded"
                        >
                            ← 返回月级
                        </button>
                    ) : null
                }
            >
                {!selectedDrillMonth ? (<>
                    {/* 图 1:金额(line)+实收率(bar)同一张图 */}
                    <div>
                        <div className="text-xs text-gray-500 mb-1">① 营业额/营业收入(线) + 实收率(柱,0-100%)</div>
                        <ResponsiveContainer width="100%" height={260}>
                            <ComposedChart data={trendData} onClick={(e: { activeLabel?: string | number }) => {
                                if (e?.activeLabel != null) {
                                    const label = String(e.activeLabel);
                                    const m = label + '-01';
                                    const found = trendData.find(d => d.month === label);
                                    if (found && (found.gross_amt > 0 || found.order_cnt > 0)) {
                                        setSelectedDrillMonth(m);
                                    }
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" interval={0} />
                                <YAxis yAxisId="left"  tickFormatter={(v: number) => fmtNum(v, 0)} width={80} />
                                <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} width={50} />
                                <Tooltip formatter={(v: unknown, name?: string | number) => {
                                    if (name === '实收率' || name === '实收率(%)') return fmtPct(Number(v), 2);
                                    return fmtNum(v, 2);
                                }} />
                                <Legend />
                                <Bar yAxisId="right" dataKey="cash_in_rate" name="实收率(%)" fill={CHART_COLORS[2]} />
                                <Line yAxisId="left"  type="monotone" dataKey="gross_amt"   name="营业额"   stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                <Line yAxisId="left"  type="monotone" dataKey="revenue_amt" name="营业收入" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    {/* 图 2:订单数 + 客单价 */}
                    <div>
                        <div className="text-xs text-gray-500 mb-1">② 订单数(左) + 客单价(右,元)</div>
                        <ResponsiveContainer width="100%" height={200}>
                            <LineChart data={trendData} onClick={(e: { activeLabel?: string | number }) => {
                                if (e?.activeLabel != null) {
                                    const label = String(e.activeLabel);
                                    const m = label + '-01';
                                    const found = trendData.find(d => d.month === label);
                                    if (found && found.order_cnt > 0) {
                                        setSelectedDrillMonth(m);
                                    }
                                }
                            }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="month" interval={0} />
                                <YAxis yAxisId="left"  tickFormatter={(v: number) => fmtNum(v, 0)} width={70} />
                                <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmtNum(v, 2)} width={70} />
                                <Tooltip formatter={(v: unknown, name?: string | number) => {
                                    if (name === '客单价') return fmtNum(Number(v), 2);
                                    return fmtNum(v, 0);
                                }} />
                                <Legend />
                                <Line yAxisId="left"  type="monotone" dataKey="order_cnt"     name="订单数" stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                                <Line yAxisId="right" type="monotone" dataKey="avg_order_amt" name="客单价" stroke={CHART_COLORS[5]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </>) : (<>
                    <div className="text-xs text-gray-500 mb-1">月内日级趋势(左轴:金额/订单数,右轴:实收率)</div>
                    <ResponsiveContainer width="100%" height={320}>
                        <LineChart data={dailyData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="date" interval={0} />
                            <YAxis yAxisId="left" tickFormatter={(v: number) => fmtNum(v, 0)} />
                            <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                            <Tooltip formatter={(v: unknown, name?: string | number) => {
                                if (name === '实收率' || name === '实收率(%)') return fmtPct(Number(v), 2);
                                return fmtNum(v, 2);
                            }} />
                            <Legend />
                            <Line yAxisId="left"  type="monotone" dataKey="gross_amt"   name="营业额"   stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            <Line yAxisId="left"  type="monotone" dataKey="revenue_amt" name="营业收入" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                            <Line yAxisId="left"  type="monotone" dataKey="order_cnt"  name="订单数"   stroke={CHART_COLORS[3]} strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
                        </LineChart>
                    </ResponsiveContainer>
                </>)}
            </Section>

            {/* 渠道分布:donut + 表 */}
            <Section title="1. 渠道分布(订单来源)">
                {channel && channel.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="min-w-0">
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={channel.map(c => ({ order_source: c.order_source, gross_amt: Number(c.gross_amt) || 0 }))}
                                        dataKey="gross_amt"
                                        nameKey="order_source"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={90}
                                    >
                                        {channel.map((c, i) => <Cell key={c.order_source} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
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

            {/* 堂食 vs 外卖:donut */}
            <Section title="2. 堂食 vs 外卖">
                {dine && dine.length > 0 ? (
                    <div className="grid grid-cols-2 gap-4">
                        <div className="min-w-0">
                            <ResponsiveContainer width="100%" height={240}>
                                <PieChart>
                                    <Pie
                                        data={dine.map(d => ({ order_type: d.order_type, gross_amt: Number(d.gross_amt) || 0 }))}
                                        dataKey="gross_amt"
                                        nameKey="order_type"
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={50}
                                        outerRadius={90}
                                    >
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
                                        <td>{fmtNum(d.gross_amt, 2)}</td>
                                        <td>{fmtNum(d.revenue_amt, 2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : <Empty />}
            </Section>

            {/* 按餐段:LineChart + select */}
            <Section title="3. 按餐段(早/午/晚市)">
                <div className="flex gap-2 mb-3 text-sm">
                    <label>维度:
                        <select className="ml-1 border rounded px-1" value={mealMetric} onChange={e => setMealMetric(e.target.value as MealMetric)}>
                            <option value="gross_amt">营业额</option>
                            <option value="revenue_amt">营业收入</option>
                            <option value="dine_takeaway">外卖堂食</option>
                        </select>
                    </label>
                </div>
                {mealMetric === 'dine_takeaway' ? (
                    dine && dine.length > 0 ? (
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={dine}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="order_type" />
                                <YAxis />
                                <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                                <Legend />
                                <Bar dataKey="gross_amt" name="营业额" fill={CHART_COLORS[0]} />
                                <Bar dataKey="order_cnt" name="订单数" fill={CHART_COLORS[2]} />
                            </BarChart>
                        </ResponsiveContainer>
                    ) : <Empty />
                ) : meal && meal.length > 0 ? (
                    <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={meal}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="meal_period" />
                            <YAxis />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            <Line type="monotone" dataKey={mealMetric} name={mealMetric === 'gross_amt' ? '营业额' : '营业收入'} stroke={CHART_COLORS[2]} strokeWidth={2} />
                        </LineChart>
                    </ResponsiveContainer>
                ) : <Empty />}
                <div className="text-xs text-gray-500 mt-2 flex flex-wrap gap-3">
                    {Object.entries(MEAL_PERIOD_LABELS).map(([k, v]) => (
                        <span key={k}><b>{k}</b>: {v}</span>
                    ))}
                </div>
            </Section>

            {/* 底部 12 月渠道趋势 */}
            <Section title="4. 渠道 12 个月趋势(近 12 月营业额)">
                {channelTrendData.length > 0 && channelSources.length > 0 ? (
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={channelTrendData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="month" />
                            <YAxis />
                            <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                            <Legend />
                            {channelSources.map((s, i) => (
                                <Line key={s} type="monotone" dataKey={s} name={s} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} />
                            ))}
                        </LineChart>
                    </ResponsiveContainer>
                ) : <Empty />}
            </Section>

            {/* 5. 多维组合 */}
            <Section title="5. 多维组合">
                <CombinedSection storeCode={storeCode} month={month} />
            </Section>
        </div>
    );
}

function CombinedSection({ storeCode, month }: { storeCode: string; month: string }) {
    const [dim1, setDim1] = useState<'order_source' | 'order_type' | 'meal_period' | 'weekday'>('order_source');
    const [dim2, setDim2] = useState<'order_source' | 'order_type' | 'meal_period' | 'weekday'>('order_type');
    const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const r = await apiGet<Array<Record<string, unknown>>>(`/api/tamkoko/sales/combined?store=${storeCode}&month=${month}&dim1=${dim1}&dim2=${dim2}`);
            if (!cancelled) setRows(r ?? null);
        })();
        return () => { cancelled = true; };
    }, [storeCode, month, dim1, dim2]);

    return (
        <>
            <div className="flex gap-2 mb-3 text-sm">
                <label>维度1:
                    <select className="ml-1 border rounded px-1" value={dim1} onChange={e => setDim1(e.target.value as typeof dim1)}>
                        <option value="order_source">渠道</option>
                        <option value="order_type">堂食/外卖</option>
                        <option value="meal_period">餐段</option>
                        <option value="weekday">星期</option>
                    </select>
                </label>
                <label>维度2:
                    <select className="ml-1 border rounded px-1" value={dim2} onChange={e => setDim2(e.target.value as typeof dim2)}>
                        <option value="order_source">渠道</option>
                        <option value="order_type">堂食/外卖</option>
                        <option value="meal_period">餐段</option>
                        <option value="weekday">星期</option>
                    </select>
                </label>
            </div>
            {rows && rows.length > 0 ? (
                <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-500"><th>{dim1}</th><th>{dim2}</th><th>订单数</th><th>营业额</th></tr></thead>
                    <tbody>
                        {rows.map((row, i) => (
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
        </>
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
