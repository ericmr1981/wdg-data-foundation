'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    BarChart, Bar, Line, ComposedChart, AreaChart, Area,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import Link from 'next/link';

const CHART_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

const fmtNum = (v: unknown, digits = 0): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtPct = (v: unknown, digits = 1): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(digits)}%`;
};

interface TrendRow { month: string; order_cnt: string; total_gross: string; total_disc: string; total_coupon: string; total_revenue: string; total_net: string; disc_rate_pct: string; coupon_rate_pct: string; net_rate_pct: string; }
interface ChannelRow { channel: string; order_cnt: string; total_gross: string; total_disc: string; total_net: string; disc_rate_pct: string; net_rate_pct: string; avg_order_value: string; }
interface BandRow { month: string; disc_band: string; order_cnt: string; total_gross: string; }
interface SummaryRow { total_orders: string; total_gross: string; total_disc: string; total_coupon: string; total_net: string; avg_disc_rate: string; avg_coupon_rate: string; avg_net_rate: string; zero_disc_orders: string; gift_orders: string; }

export default function DiscountPage() {
    const searchParams = useSearchParams();
    const storeCode = searchParams.get('store') || 'sh_xtd';

    // Get current month as default
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [month, setMonth] = useState(defaultMonth);
    const [excludeGifts, setExcludeGifts] = useState(true); // 默认纯净

    const [data, setData] = useState<{ trend: TrendRow[]; channels: ChannelRow[]; bands: BandRow[]; summary: SummaryRow | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [storeName, setStoreName] = useState('');

    useEffect(() => {
        fetch('/api/stores?brand=gelatomiiix')
            .then(r => r.json())
            .then(json => {
                if (json.success && json.data?.length) {
                    const s = json.data.find((s: any) => s.store_code === storeCode);
                    if (s) setStoreName(s.store_name);
                }
            })
            .catch(() => {});
    }, [storeCode]);

    useEffect(() => {
        setError(null);
        const params = new URLSearchParams({ store: storeCode });
        if (excludeGifts) params.set('exclude_gifts', 'true');
        params.set('month', month);
        fetch(`/api/gelatomiiix/sales/discount?${params}`)
            .then(r => r.json())
            .then(json => {
                if (json.success) setData(json.data);
                else setError(json.error);
            })
            .catch(e => setError(e.message));
    }, [storeCode, month, excludeGifts]);

    const s = data?.summary;
    const trend = (data?.trend ?? []).map(t => ({
        month: String(t.month).slice(0, 7),
        discRate: Number(t.disc_rate_pct),
        netRate: Number(t.net_rate_pct),
        couponRate: Number(t.coupon_rate_pct),
        gross: Number(t.total_gross),
        net: Number(t.total_net),
        orders: Number(t.order_cnt),
    }));
    const channels = (data?.channels ?? []).map(c => ({
        channel: c.channel,
        discRate: Number(c.disc_rate_pct),
        netRate: Number(c.net_rate_pct),
        gross: Number(c.total_gross),
        disc: Number(c.total_disc),
        avgValue: Number(c.avg_order_value),
    })).sort((a, b) => b.gross - a.gross);

    const bandMap: Record<string, { orders: number; gross: number }> = {};
    for (const b of (data?.bands ?? [])) {
        const key = b.disc_band;
        if (!bandMap[key]) bandMap[key] = { orders: 0, gross: 0 };
        bandMap[key].orders += Number(b.order_cnt);
        bandMap[key].gross += Number(b.total_gross);
    }
    const bandOrder = ['0%', '0-15%', '15-50%', '50%+'];
    const bandData = bandOrder.filter(k => bandMap[k]).map(k => ({
        band: k,
        orders: bandMap[k].orders,
        gross: bandMap[k].gross,
    }));

    // Stacked area: discount band trend over months
    const bandTrendMonths = [...new Set((data?.bands ?? []).map(b => String(b.month).slice(0, 7)))].sort();
    const bandTrendData = bandTrendMonths.map(m => {
        const row: Record<string, string | number> = { month: m };
        const monthBands = (data?.bands ?? []).filter(b => String(b.month).slice(0, 7) === m);
        for (const bb of bandOrder) {
            const found = monthBands.find(b => b.disc_band === bb);
            row[bb] = found ? Number(found.order_cnt) : 0;
        }
        return row;
    });

    return (
        <div className="p-6 max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex justify-between items-end">
                <div>
                    <h1 className="text-2xl font-bold">蜜可诗 — 折扣率分析</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        门店: {storeName || storeCode} | 订单级折扣率、手续费、净收率
                    </p>
                </div>
                <div className="flex items-end gap-4">
                    <label className="text-xs">
                        <div className="text-gray-500 mb-1">月份</div>
                        <input className="border rounded px-2 py-1 text-sm" type="month"
                            value={month} onChange={e => setMonth(e.target.value)} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none pb-0.5">
                        <input type="checkbox" checked={excludeGifts}
                            onChange={e => setExcludeGifts(e.target.checked)} className="rounded" />
                        剔除赠品
                    </label>
                    <Link href="/u/sales/gelatomiiix"
                        className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition-colors">
                        ← 返回销售报表
                    </Link>
                </div>
            </div>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded">错误: {error}</div>}

            {/* Summary Cards */}
            {s && (
                <div className="grid grid-cols-5 gap-4">
                    <div className="rounded-lg p-4 bg-blue-50">
                        <div className="text-xs text-gray-500">订单总数</div>
                        <div className="text-xl font-bold mt-1">{fmtNum(s.total_orders)}</div>
                    </div>
                    <div className="rounded-lg p-4 bg-green-50">
                        <div className="text-xs text-gray-500">平均折扣率</div>
                        <div className="text-xl font-bold mt-1">{fmtPct(s.avg_disc_rate)}</div>
                        <div className="text-xs mt-1 text-gray-500">折扣 ¥{fmtNum(s.total_disc)}</div>
                    </div>
                    <div className="rounded-lg p-4 bg-yellow-50">
                        <div className="text-xs text-gray-500">平均手续费率</div>
                        <div className="text-xl font-bold mt-1">{fmtPct(s.avg_coupon_rate)}</div>
                        <div className="text-xs mt-1 text-gray-500">手续费 ¥{fmtNum(s.total_coupon)}</div>
                    </div>
                    <div className="rounded-lg p-4 bg-violet-50">
                        <div className="text-xs text-gray-500">平均净收率</div>
                        <div className="text-xl font-bold mt-1">{fmtPct(s.avg_net_rate)}</div>
                        <div className="text-xs mt-1 text-gray-500">净收 ¥{fmtNum(s.total_net)}</div>
                    </div>
                    <div className="rounded-lg p-4 bg-pink-50">
                        <div className="text-xs text-gray-500">赠品订单</div>
                        <div className="text-xl font-bold mt-1">{fmtNum(s.gift_orders)}</div>
                        <div className="text-xs mt-1 text-gray-500">零折扣 {fmtNum(s.zero_disc_orders)}</div>
                    </div>
                </div>
            )}

            {/* 1. Monthly trend */}
            <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">月度折扣率 & 净收率趋势</h3>
                <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={trend}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis yAxisId="left" tickFormatter={(v: number) => `${v}%`} domain={[0, 'auto']} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v: number) => fmtNum(v, 0)} />
                        <Tooltip formatter={(v: unknown, name: unknown) =>
                            String(name ?? '').includes('Rate') ? fmtPct(v) : `¥${fmtNum(v)}`} />
                        <Legend />
                        <Bar yAxisId="left" dataKey="discRate" name="折扣率" fill={CHART_COLORS[3]} radius={[3, 3, 0, 0]} barSize={20} />
                        <Line yAxisId="left" dataKey="netRate" name="净收率" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} />
                        <Line yAxisId="right" dataKey="gross" name="营业额" stroke={CHART_COLORS[1]} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>

            {/* 2. Channel */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-semibold mb-3">渠道折扣率对比</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={channels} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tickFormatter={(v: number) => `${v}%`} />
                            <YAxis type="category" dataKey="channel" tick={{ fontSize: 12 }} width={70} />
                            <Tooltip formatter={(v: unknown) => fmtPct(v)} />
                            <Bar dataKey="discRate" name="折扣率" fill={CHART_COLORS[3]} radius={[0, 4, 4, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
                <div className="bg-white border rounded-lg p-4">
                    <h3 className="font-semibold mb-3">渠道净收率 & 平均客单价</h3>
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={channels} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis type="number" tickFormatter={(v: unknown) => fmtPct(v, 0)} />
                            <YAxis type="category" dataKey="channel" tick={{ fontSize: 12 }} width={70} />
                            <Tooltip formatter={(v: unknown, name: unknown) =>
                                String(name ?? '') === '平均客单价' ? `¥${fmtNum(v)}` : fmtPct(v)} />
                            <Bar dataKey="netRate" name="净收率" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} barSize={16} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* 3. Discount structure over time */}
            <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">折扣结构月度变化</h3>
                <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={bandTrendData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                        <Tooltip formatter={(v: unknown) => fmtNum(v, 0)} />
                        <Legend />
                        {bandOrder.map((b, i) => (
                            <Area key={b} type="monotone" dataKey={b} name={b} stackId="1"
                                stroke={CHART_COLORS[i]} fill={CHART_COLORS[i]} fillOpacity={0.3} />
                        ))}
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            {/* 5. Band distribution */}
            <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">折扣段分布</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-xs text-gray-500 mb-2">按订单数</div>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={bandData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="band" />
                                <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                <Tooltip formatter={(v: unknown) => fmtNum(v, 0)} />
                                <Bar dataKey="orders" name="订单数" radius={[4, 4, 0, 0]}>
                                    {bandData.map((_, i) => (
                                        <rect key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div>
                        <div className="text-xs text-gray-500 mb-2">按营业额</div>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={bandData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="band" />
                                <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                <Tooltip formatter={(v: unknown) => `¥${fmtNum(v)}`} />
                                <Bar dataKey="gross" name="营业额" radius={[4, 4, 0, 0]}>
                                    {bandData.map((_, i) => (
                                        <rect key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* Data note */}
            <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-600">
                <p><strong>数据说明：</strong></p>
                <ul className="mt-1 space-y-0.5 list-disc list-inside">
                    <li>折扣率 = 优惠金额 / 营业额 · 手续费率 = 手续费 / 营业收入 · 净收率 = 营业净收 / 营业额</li>
                    <li>数据来源：<code>gelatomiiix_ods.income_detail</code>（订单级），默认纯净模式（排除退款 + 仅含有效支付方式），与销售报表统一口径</li>
                    <li>「剔除赠品」会排除优惠金额 ≥ 营业收入（即 100% 折扣）的订单（默认开启）</li>
                    <li>溢收金额(overflow_amt)暂未在折扣率中体现，高估约¥31/天</li>
                </ul>
            </div>
        </div>
    );
}
