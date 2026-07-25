'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
    BarChart, Bar, Line, LineChart, ComposedChart, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
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

const DISCOUNT_BUCKET_SIZE = 5;

// 模型快照（来自 artifacts/discount_order_regression_report_2025-08_2026-07.txt）
// 注意：以下为模型产出的固定快照，并非基于当前选中月份实时重算。
// 模型快照从 API（/api/discount-model/coefficients 与 /baseline）实时读取
// 旧版静态 MODEL_SNAPSHOT / BASELINE_SNAPSHOT / baselineDaily 已被替换为 API 动态加载
type ModelSnapshot = {
    version: string;
    dataRange: { start: string; end: string };
    sampleDays: number;
    totalOrders: number;
    olsCoef: number;
    olsR2: number;
    poissonCoef: number;
    nbCoef: number;
    nbExpBeta: number;
    nbPvalue: number;
    nbAlpha: number;
    nbConverged: boolean;
    simpleCorr: number;
    overdispersion: number;
    controls: string[];
    fallbackTo?: string | null;
    warnings: string[];
};

type BaselineSnapshot = {
    trainRange: { start: string; end: string };
    evalRange: { start: string; end: string };
    evalDays: number;
    alpha: number;
    formula?: string;
    overall: {
        actual: number; predicted: number; residual: number;
        incrementalRate: number; mae: number; rmse: number; wape: number; bias: number;
    };
    june: {
        days: number; actual: number; predicted: number; residual: number;
        incrementalRate: number; mae: number; rmse: number; wape: number; bias: number;
    };
    july: {
        days: number; actual: number; predicted: number; residual: number;
        incrementalRate: number; mae: number; rmse: number; wape: number; bias: number;
    };
    daily?: Array<{ date: string; order_count: number; predicted_orders: number; residual_orders: number; avg_discount_rate_pct: number }>;
};

// 临时占位：API 未返回时使用上一次手动运行产出的快照（保证页面不出现 NaN）
// 一旦 admin 重跑模型，下方 useEffect 会用最新值覆盖
const FALLBACK_MODEL: ModelSnapshot = {
    version: '2026-07-25T17-25-22',
    dataRange: { start: '2025-08-17', end: '2026-07-16' },
    sampleDays: 334,
    totalOrders: 12225,
    olsCoef: 0.053326,
    olsR2: 0.552,
    poissonCoef: 0.048816,
    nbCoef: 0.0515350509,
    nbExpBeta: 1.052886,
    nbPvalue: 1.87e-10,
    nbAlpha: 0.151202,
    nbConverged: true,
    simpleCorr: 0.4329,
    overdispersion: 7.46,
    controls: ['月份固定效应', '周末', '法定节假日', '调休工作日', '平均气温', '是否降雨'],
    fallbackTo: null,
    warnings: [],
};

// 基线月度拆分占位：API 主要返回 overall 指标，june/july 拆分使用静态 fallback
const FALLBACK_BASELINE = {
    overall: {
        actual: 2572, predicted: 1474.1, residual: 1097.9,
        incrementalRate: 0.7447, mae: 29.02, rmse: 38.89, wape: 0.5189, bias: 23.87,
    },
    june: {
        days: 30, actual: 1550, predicted: 981.8, residual: 568.2,
        incrementalRate: 0.5788, mae: 25.1, rmse: 36.92, wape: 0.4858, bias: 18.94,
    },
    july: {
        days: 16, actual: 1022, predicted: 492.4, residual: 529.6,
        incrementalRate: 1.0756, mae: 36.36, rmse: 42.33, wape: 0.5692, bias: 33.1,
    },
};

const MODEL_DISCOUNT_RATES = [0, 5, 10, 15, 20, 25, 30, 35, 40];

// 调整后订单指数：在组件内基于 modelSnap 派生
function buildModelIndex(snap: ModelSnapshot) {
    return MODEL_DISCOUNT_RATES.map(rate => ({
        rate,
        poissonIndex: Math.exp(snap.poissonCoef * rate) * 100,
        nbIndex: Math.exp(snap.nbCoef * rate) * 100,
    }));
}

// 将 API 返回的 baseline.daily 映射为页面使用的 BaselineDailyRow
type BaselineDailyRow = {
    date: string;
    month: string;
    actual: number;
    predicted: number;
    residual: number;
    discountRate: number;
};

function mapBaselineDaily(daily: NonNullable<BaselineSnapshot['daily']>): BaselineDailyRow[] {
    return daily.map(d => ({
        date: d.date,
        month: d.date.slice(0, 7),
        actual: d.order_count,
        predicted: d.predicted_orders,
        residual: d.residual_orders,
        discountRate: d.avg_discount_rate_pct,
    }));
}

function buildCumulative(daily: BaselineDailyRow[]) {
    let cumActual = 0;
    let cumPredicted = 0;
    return daily.map((row) => {
        cumActual += row.actual;
        cumPredicted += row.predicted;
        return {
            date: row.date.slice(5),
            cumActual: Math.round(cumActual * 10) / 10,
            cumPredicted: Math.round(cumPredicted * 10) / 10,
            cumResidual: Math.round((cumActual - cumPredicted) * 10) / 10,
        };
    });
}

const normalizeDiscountBand = (raw: string): string => {
    const label = String(raw || '').trim();
    if (label === '0%') return label;
    const exact = label.match(/^(\d+(?:\.\d+)?)%\+?$/);
    if (exact) {
        const value = Number(exact[1]);
        return value >= 100 ? '100%+' : `${Math.floor(value / DISCOUNT_BUCKET_SIZE) * DISCOUNT_BUCKET_SIZE}%`;
    }
    const range = label.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)%$/);
    if (range && Number(range[2]) - Number(range[1]) <= DISCOUNT_BUCKET_SIZE) {
        return `${Math.floor(Number(range[1]) / DISCOUNT_BUCKET_SIZE) * DISCOUNT_BUCKET_SIZE}%`;
    }
    return label;
};

const discountBandSortValue = (label: string): number => {
    const value = Number(label.match(/\d+/)?.[0]);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
};

const aggregateBandRows = (rows: BandRow[]) => {
    const grouped: Record<string, { orders: number; gross: number }> = {};
    rows.forEach(row => {
        const band = normalizeDiscountBand(row.disc_band);
        if (!band) return;
        if (!grouped[band]) grouped[band] = { orders: 0, gross: 0 };
        grouped[band].orders += Number(row.order_cnt) || 0;
        grouped[band].gross += Number(row.total_gross) || 0;
    });
    return Object.entries(grouped)
        .map(([band, values]) => ({ band, ...values }))
        .sort((a, b) => discountBandSortValue(a.band) - discountBandSortValue(b.band));
};

export default function DiscountPage() {
    const searchParams = useSearchParams();
    const storeCode = searchParams.get('store') || 'sh_xtd';

    // Get current month as default
    const now = new Date();
    now.setMonth(now.getMonth() - 1);
    const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [month, setMonth] = useState(defaultMonth);
    const [excludeGifts, setExcludeGifts] = useState(true); // 默认纯净

    const [data, setData] = useState<{ trend: TrendRow[]; channels: ChannelRow[]; bands: BandRow[]; allBands: BandRow[]; summary: SummaryRow | null } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [storeName, setStoreName] = useState('');

    // 模型快照：从 /api/discount-model/coefficients 与 /baseline 加载
    const [modelSnap, setModelSnap] = useState<ModelSnapshot>(FALLBACK_MODEL);
    const [modelLoading, setModelLoading] = useState(true);
    const [baselineSnap, setBaselineSnap] = useState<BaselineSnapshot | null>(null);
    const [baselineDaily, setBaselineDaily] = useState<BaselineDailyRow[]>([]);
    const [baselineCumulative, setBaselineCumulative] = useState<Array<{date:string;cumActual:number;cumPredicted:number;cumResidual:number}>>([]);
    const [baselineLoading, setBaselineLoading] = useState(true);
    const [modelVersion, setModelVersion] = useState<string>(FALLBACK_MODEL.version);
    const [modelFallbackTo, setModelFallbackTo] = useState<string | null>(null);

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

    // 模型系数快照
    useEffect(() => {
        setModelLoading(true);
        fetch(`/api/discount-model/coefficients?store_code=${storeCode}`)
            .then(r => r.ok ? r.json() : null)
            .then((json) => {
                if (json && json.payload) {
                    const p = json.payload;
                    const ols = p.models?.find((m: any) => m.model === 'OLS');
                    const poi = p.models?.find((m: any) => m.model === 'Poisson');
                    const nb  = p.models?.find((m: any) => m.model === 'NegativeBinomial');
                    setModelSnap({
                        version: json.version,
                        dataRange: {
                            start: json.data_range_start || p.data_range?.start,
                            end: json.data_range_end || p.data_range?.end,
                        },
                        sampleDays: p.n_obs || 0,
                        totalOrders: p.n_orders || 0,
                        olsCoef: ols?.coef_avg_discount_rate_pct ?? FALLBACK_MODEL.olsCoef,
                        olsR2: p.ols_r_squared ?? FALLBACK_MODEL.olsR2,
                        poissonCoef: poi?.coef_avg_discount_rate_pct ?? FALLBACK_MODEL.poissonCoef,
                        nbCoef: nb?.coef_avg_discount_rate_pct ?? FALLBACK_MODEL.nbCoef,
                        nbExpBeta: nb?.exp_coef ?? FALLBACK_MODEL.nbExpBeta,
                        nbPvalue: nb?.p_value ?? FALLBACK_MODEL.nbPvalue,
                        nbAlpha: p.negative_binomial_alpha ?? FALLBACK_MODEL.nbAlpha,
                        nbConverged: Number.isFinite(p.negative_binomial_alpha),
                        simpleCorr: p.simple_correlation?.avg_discount_rate_pct_vs_order_count ?? FALLBACK_MODEL.simpleCorr,
                        overdispersion: p.poisson_pearson_dispersion ?? FALLBACK_MODEL.overdispersion,
                        controls: FALLBACK_MODEL.controls,
                        fallbackTo: json.fallback_to ?? null,
                        warnings: json.warnings || [],
                    });
                    setModelVersion(json.version);
                    setModelFallbackTo(json.fallback_to ?? null);
                }
            })
            .catch(() => { /* keep fallback */ })
            .finally(() => setModelLoading(false));
    }, [storeCode]);

    // 无折扣基线快照
    useEffect(() => {
        setBaselineLoading(true);
        fetch(`/api/discount-model/baseline?store_code=${storeCode}`)
            .then(r => r.ok ? r.json() : null)
            .then((json) => {
                if (json && json.payload) {
                    const p = json.payload;
                    const daily = mapBaselineDaily(p.daily || []);
                    setBaselineDaily(daily);
                    setBaselineCumulative(buildCumulative(daily));
                    setBaselineSnap({
                        trainRange: { start: p.train_range?.start, end: p.train_range?.end },
                        evalRange: { start: p.eval_range?.start, end: p.eval_range?.end },
                        evalDays: p.n_eval || daily.length,
                        alpha: p.alpha || 0,
                        formula: p.formula,
                        overall: p.metrics ? {
                            actual: p.metrics.actual_orders ?? FALLBACK_BASELINE.overall.actual,
                            predicted: p.metrics.predicted_orders ?? FALLBACK_BASELINE.overall.predicted,
                            residual: p.metrics.residual_orders ?? FALLBACK_BASELINE.overall.residual,
                            incrementalRate: p.metrics.lift_vs_baseline_pct != null
                                ? p.metrics.lift_vs_baseline_pct / 100    // API 返回的是百分比（如 51.84），转小数
                                : FALLBACK_BASELINE.overall.incrementalRate,  // fallback 已是小数
                            mae: p.metrics.MAE ?? FALLBACK_BASELINE.overall.mae,
                            rmse: p.metrics.RMSE ?? FALLBACK_BASELINE.overall.rmse,
                            wape: p.metrics.WAPE ?? FALLBACK_BASELINE.overall.wape,
                            bias: p.metrics.Bias ?? FALLBACK_BASELINE.overall.bias,
                        } : FALLBACK_BASELINE.overall,
                        june: FALLBACK_BASELINE.june,
                        july: FALLBACK_BASELINE.july,
                        daily: p.daily,
                    });
                }
            })
            .catch(() => { /* keep null */ })
            .finally(() => setBaselineLoading(false));
    }, [storeCode]);

    // 派生：调整后订单指数曲线
    const modelIndexData = useMemo(() => buildModelIndex(modelSnap), [modelSnap]);

    useEffect(() => {
        setError(null);
        const params = new URLSearchParams({ store: storeCode });
        if (excludeGifts) params.set('exclude_gifts', 'true');
        params.set('month', month);
        const allParams = new URLSearchParams({ store: storeCode });
        if (excludeGifts) allParams.set('exclude_gifts', 'true');
        Promise.all([
            fetch(`/api/gelatomiiix/sales/discount?${params}`).then(r => r.json()),
            fetch(`/api/gelatomiiix/sales/discount?${allParams}`).then(r => r.json()),
        ])
            .then(([json, allJson]) => {
                if (json.success) {
                    setData({
                        ...json.data,
                        allBands: allJson.success ? allJson.data.bands : json.data.bands,
                    });
                } else {
                    setError(json.error);
                }
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

    const currentBandData = aggregateBandRows(data?.bands ?? []);
    const allBandRows = data?.allBands ?? data?.bands ?? [];
    const allBandData = aggregateBandRows(allBandRows);
    const bandKeys = allBandData.map(item => item.band);
    const bandTrendMonths = [...new Set(allBandRows.map(b => String(b.month).slice(0, 7)))].sort().slice(-12);
    const bandTrendData = bandTrendMonths.map(m => {
        const row: Record<string, string | number> = { month: m };
        const monthRows = allBandRows.filter(b => String(b.month).slice(0, 7) === m);
        const monthData = aggregateBandRows(monthRows);
        const counts = Object.fromEntries(monthData.map(item => [item.band, item.orders]));
        bandKeys.forEach(band => { row[band] = counts[band] ?? 0; });
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
                        <Line yAxisId="right" dataKey="net" name="净收入" stroke={CHART_COLORS[2]} strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2.5 }} />
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
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1">
                        <div className="text-xs text-gray-500 mb-2">{month} 订单数分布</div>
                        {currentBandData.length ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <PieChart>
                                    <Pie
                                        data={currentBandData}
                                        dataKey="orders"
                                        nameKey="band"
                                        innerRadius={52}
                                        outerRadius={82}
                                        paddingAngle={2}
                                    >
                                        {currentBandData.map((item, i) => (
                                            <Cell key={item.band} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip formatter={(v: unknown) => [`${fmtNum(v, 0)} 单`, '订单数']} />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[260px] flex items-center justify-center text-sm text-gray-400">暂无折扣档位数据</div>
                        )}
                    </div>
                    <div className="md:col-span-2">
                        <div className="text-xs text-gray-500 mb-2">最近 12 个月各折扣档位订单数趋势</div>
                        {bandTrendData.length && bandKeys.length ? (
                            <ResponsiveContainer width="100%" height={260}>
                                <LineChart data={bandTrendData}>
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis dataKey="month" tick={{ fontSize: 11 }} minTickGap={20} />
                                    <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                    <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtNum(v, 0)} 单`, String(name)]} />
                                    <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                                    {bandKeys.map((band, i) => (
                                        <Line
                                            key={band}
                                            type="monotone"
                                            dataKey={band}
                                            name={band}
                                            stroke={CHART_COLORS[i % CHART_COLORS.length]}
                                            strokeWidth={2}
                                            dot={{ r: 2.5 }}
                                            activeDot={{ r: 4 }}
                                            connectNulls
                                        />
                                    ))}
                                </LineChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-[260px] flex items-center justify-center text-sm text-gray-400">暂无月度趋势数据</div>
                        )}
                    </div>
                </div>
            </div>

            {/* 5. Band distribution */}
            <div className="bg-white border rounded-lg p-4">
                <h3 className="font-semibold mb-3">折扣段分布</h3>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="text-xs text-gray-500 mb-2">按订单数</div>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={currentBandData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="band" />
                                <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                <Tooltip formatter={(v: unknown) => fmtNum(v, 0)} />
                                <Bar dataKey="orders" name="订单数" radius={[4, 4, 0, 0]}>
                                    {currentBandData.map((_, i) => (
                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <div>
                        <div className="text-xs text-gray-500 mb-2">按营业额</div>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={currentBandData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="band" />
                                <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                                <Tooltip formatter={(v: unknown) => `¥${fmtNum(v)}`} />
                                <Bar dataKey="gross" name="营业额" radius={[4, 4, 0, 0]}>
                                    {currentBandData.map((_, i) => (
                                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>

            {/* 6. Model analysis snapshot */}
            <div className="bg-white border rounded-lg p-4">
                <div className="flex items-baseline justify-between mb-1">
                    <h3 className="font-semibold">模型分析结果</h3>
                    <span className="text-xs text-gray-500">
                        快照 · 数据区间 {modelSnap.dataRange.start} ~ {modelSnap.dataRange.end}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                    控制月份、周末、法定节假日、调休工作日、平均气温与是否降雨后，平均折扣率与日订单数呈<strong>正向统计关联</strong>，三种模型（OLS / Poisson / 负二项）方向一致，可视为同一信号的稳健性佐证。下方为模型快照，非实时重算。
                </p>

                {/* Coefficient & sample cards */}
                <div className="grid grid-cols-5 gap-3 mb-4">
                    <div className="rounded-lg p-3 bg-blue-50">
                        <div className="text-xs text-gray-500">OLS 折扣率系数</div>
                        <div className="text-xl font-bold mt-1">+{modelSnap.olsCoef.toFixed(6)}</div>
                        <div className="text-xs mt-1 text-gray-500">log(1+订单数) / 百分点 · R² {modelSnap.olsR2.toFixed(3)}</div>
                    </div>
                    <div className="rounded-lg p-3 bg-green-50">
                        <div className="text-xs text-gray-500">Poisson 折扣率系数</div>
                        <div className="text-xl font-bold mt-1">+{modelSnap.poissonCoef.toFixed(6)}</div>
                        <div className="text-xs mt-1 text-gray-500">log(订单数) / 百分点 · exp(β) ≈ 1.0500</div>
                    </div>
                    <div className="rounded-lg p-3 bg-emerald-50">
                        <div className="text-xs text-gray-500">负二项 折扣率系数</div>
                        <div className="text-xl font-bold mt-1">+{modelSnap.nbCoef.toFixed(7)}</div>
                        <div className="text-xs mt-1 text-gray-500">
                            log(订单数) / 百分点 · exp(β) ≈ {modelSnap.nbExpBeta.toFixed(4)} · p = {modelSnap.nbPvalue.toExponential(2)}
                        </div>
                    </div>
                    <div className="rounded-lg p-3 bg-yellow-50">
                        <div className="text-xs text-gray-500">简单相关系数</div>
                        <div className="text-xl font-bold mt-1">+{modelSnap.simpleCorr.toFixed(4)}</div>
                        <div className="text-xs mt-1 text-gray-500">未控制季节/天气/日历</div>
                    </div>
                    <div className="rounded-lg p-3 bg-violet-50">
                        <div className="text-xs text-gray-500">样本 / 订单量</div>
                        <div className="text-xl font-bold mt-1">{modelSnap.sampleDays} 天</div>
                        <div className="text-xs mt-1 text-gray-500">{fmtNum(modelSnap.totalOrders)} 单 · 单门店 sh_xtd</div>
                    </div>
                </div>

                {/* Effect trend chart */}
                <div>
                    <div className="text-xs text-gray-500 mb-2">
                        调整后订单乘数 vs 平均折扣率（基准 0% = 100，其他控制变量保持不变；Poisson / 负二项均为对数链接模型，系数经指数化后沿折扣率外推。OLS 为线性模型，不适用此乘数公式，故不展示）
                    </div>
                    <ResponsiveContainer width="100%" height={260}>
                        <LineChart data={modelIndexData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="rate"
                                tickFormatter={(v: number) => `${v}%`}
                                tick={{ fontSize: 11 }}
                                label={{ value: '平均折扣率', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#6b7280' }}
                            />
                            <YAxis
                                tickFormatter={(v: number) => `${v.toFixed(0)}`}
                                domain={[80, 'auto']}
                                label={{ value: '订单指数', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6b7280' }}
                            />
                            <Tooltip
                                labelFormatter={(label: unknown) => `折扣率 ${label}%`}
                                formatter={(v: unknown, name: unknown) => {
                                    const num = Number(v);
                                    return [`${Number.isFinite(num) ? num.toFixed(1) : '-'}`, String(name)];
                                }}
                            />
                            <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                            <Line
                                type="monotone"
                                dataKey="poissonIndex"
                                name="Poisson 指数"
                                stroke={CHART_COLORS[1]}
                                strokeWidth={2}
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                            <Line
                                type="monotone"
                                dataKey="nbIndex"
                                name="负二项指数"
                                stroke={CHART_COLORS[4]}
                                strokeWidth={2}
                                strokeDasharray="6 3"
                                dot={{ r: 3 }}
                                activeDot={{ r: 5 }}
                            />
                        </LineChart>
                    </ResponsiveContainer>
                </div>

                {/* Warnings & caveats */}
                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
                        <strong>过度离散提醒：</strong>Poisson 模型 Pearson χ² / 残差自由度 = <strong>{modelSnap.overdispersion.toFixed(2)}</strong>（远大于 1），标准误与显著性需谨慎解读；本快照已补跑<strong>负二项回归</strong>（α = {modelSnap.nbAlpha.toFixed(6)}，{modelSnap.nbConverged ? '已收敛' : '未收敛'}）控制过度离散，三种模型方向一致，仍可作稳健性佐证，但样本仍仅限单门店。
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded p-3 text-blue-800">
                        <strong>统计关联 ≠ 因果：</strong>仅控制日历与天气后的估计；折扣可能因订单低迷而被上调，存在反向因果，不可据此判定"加大折扣→拉高订单"。若需因果结论，需门店/日期层面的 A/B 或差分中的差分。以上系数均为<strong>固定快照</strong>，并非基于上方月份筛选实时重算。
                    </div>
                </div>
            </div>

            {/* 7. Discount-free baseline prediction */}
            <div className="bg-white border rounded-lg p-4">
                <div className="flex items-baseline justify-between mb-1">
                    <h3 className="font-semibold">无折扣基线预测 vs 实际订单</h3>
                    <span className="text-xs text-gray-500">
                        训练 {baselineSnap?.trainRange.start ?? "-"} ~ {baselineSnap?.trainRange.end ?? "-"} ·
                        评估 {baselineSnap?.evalRange.start ?? "-"} ~ {baselineSnap?.evalRange.end ?? "-"}
                    </span>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                    使用<strong>负二项回归</strong>（不包含任何折扣变量），控制星期、季节周期、法定节假日、调休工作日、平均气温与是否降雨；
                    模型输出的是「假如没有折扣」的事后基线。下方为静态快照，非实时重算。
                    <strong className="text-amber-700">天气使用事后实际观测</strong>，仅适合事后评估；若用于真实预测应替换为当时可得的天气预报。
                </p>

                {/* Overall KPI cards */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                    <div className="rounded-lg p-3 bg-blue-50">
                        <div className="text-xs text-gray-500">评估天数 / 总实际</div>
                        <div className="text-xl font-bold mt-1">{baselineSnap?.evalDays ?? 0} 天 · {fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).actual)} 单</div>
                        <div className="text-xs mt-1 text-gray-500">基线预测 {fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).predicted, 1)}</div>
                    </div>
                    <div className="rounded-lg p-3 bg-emerald-50">
                        <div className="text-xs text-gray-500">相对基线增量</div>
                        <div className="text-xl font-bold mt-1">+{fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).residual, 1)} 单</div>
                        <div className="text-xs mt-1 text-gray-500">增量率 +{fmtPct((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).incrementalRate * 100)}</div>
                    </div>
                    <div className="rounded-lg p-3 bg-yellow-50">
                        <div className="text-xs text-gray-500">MAE / RMSE</div>
                        <div className="text-xl font-bold mt-1">{fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).mae, 2)} / {fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).rmse, 2)}</div>
                        <div className="text-xs mt-1 text-gray-500">单/日 · bias +{fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).bias, 2)}</div>
                    </div>
                    <div className="rounded-lg p-3 bg-violet-50">
                        <div className="text-xs text-gray-500">WAPE（绝对误差 / 总实际）</div>
                        <div className="text-xl font-bold mt-1">{fmtPct((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).wape * 100)}</div>
                        <div className="text-xs mt-1 text-gray-500">α = {(baselineSnap?.alpha ?? 0).toFixed(4)}（已收敛）</div>
                    </div>
                </div>

                {/* Monthly KPI strip */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-lg p-3 border border-blue-200 bg-blue-50/50">
                        <div className="text-xs text-gray-500 mb-1">2026-06 · {(baselineSnap?.june ?? FALLBACK_BASELINE.june).days} 天</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            <span>实际 <strong>{fmtNum((baselineSnap?.june ?? FALLBACK_BASELINE.june).actual)}</strong></span>
                            <span>基线 <strong>{fmtNum((baselineSnap?.june ?? FALLBACK_BASELINE.june).predicted, 1)}</strong></span>
                            <span>残差 <strong className="text-emerald-700">+{fmtNum((baselineSnap?.june ?? FALLBACK_BASELINE.june).residual, 1)}</strong></span>
                            <span>增量率 <strong className="text-emerald-700">+{fmtPct((baselineSnap?.june ?? FALLBACK_BASELINE.june).incrementalRate * 100)}</strong></span>
                            <span>WAPE <strong>{fmtPct((baselineSnap?.june ?? FALLBACK_BASELINE.june).wape * 100)}</strong></span>
                        </div>
                    </div>
                    <div className="rounded-lg p-3 border border-blue-200 bg-blue-50/50">
                        <div className="text-xs text-gray-500 mb-1">2026-07 · {(baselineSnap?.july ?? FALLBACK_BASELINE.july).days} 天（截至 7/16）</div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            <span>实际 <strong>{fmtNum((baselineSnap?.july ?? FALLBACK_BASELINE.july).actual)}</strong></span>
                            <span>基线 <strong>{fmtNum((baselineSnap?.july ?? FALLBACK_BASELINE.july).predicted, 1)}</strong></span>
                            <span>残差 <strong className="text-emerald-700">+{fmtNum((baselineSnap?.july ?? FALLBACK_BASELINE.july).residual, 1)}</strong></span>
                            <span>增量率 <strong className="text-emerald-700">+{fmtPct((baselineSnap?.july ?? FALLBACK_BASELINE.july).incrementalRate * 100)}</strong></span>
                            <span>WAPE <strong>{fmtPct((baselineSnap?.july ?? FALLBACK_BASELINE.july).wape * 100)}</strong></span>
                        </div>
                    </div>
                </div>

                {/* Daily actual vs predicted line chart */}
                <div className="text-xs text-gray-500 mb-2">日订单：实际 vs 无折扣基线预测（2026-06-01 ~ 2026-07-16，共 {baselineSnap?.evalDays ?? 0} 天）</div>
                <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={baselineDaily.map((d) => ({
                        date: d.date.slice(5),
                        actual: d.actual,
                        predicted: Math.round(d.predicted * 10) / 10,
                    }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
                        <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                        <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtNum(Number(v), 1)} 单`, String(name)]} />
                        <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="actual" name="实际订单" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 2.5 }} activeDot={{ r: 5 }} />
                        <Line type="monotone" dataKey="predicted" name="无折扣基线预测" stroke={CHART_COLORS[3]} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                    </LineChart>
                </ResponsiveContainer>

                {/* Cumulative comparison */}
                <div className="text-xs text-gray-500 mt-5 mb-2">累计订单：实际 vs 无折扣基线（差距 = 评估窗口内累计增量订单）</div>
                <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={baselineCumulative}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={20} />
                        <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                        <Tooltip formatter={(v: unknown, name: unknown) => [`${fmtNum(Number(v), 1)} 单`, String(name)]} />
                        <Legend iconType="line" wrapperStyle={{ fontSize: 11 }} />
                        <Line type="monotone" dataKey="cumActual" name="累计实际" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="cumPredicted" name="累计基线预测" stroke={CHART_COLORS[3]} strokeWidth={2} strokeDasharray="5 4" dot={false} />
                        <Line type="monotone" dataKey="cumResidual" name="累计增量" stroke={CHART_COLORS[1]} strokeWidth={1.5} strokeDasharray="2 2" dot={false} />
                    </LineChart>
                </ResponsiveContainer>

                {/* Residual vs discount rate scatter */}
                <div className="text-xs text-gray-500 mt-5 mb-2">每日残差 vs 当日平均折扣率（散点）— 仅展示<strong>残差不能全部归因于折扣</strong>，请结合下方说明</div>
                <ResponsiveContainer width="100%" height={260}>
                    <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis
                            dataKey="discountRate"
                            name="当日平均折扣率"
                            type="number"
                            domain={[0, 'auto']}
                            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                            label={{ value: '当日平均折扣率 %', position: 'insideBottom', offset: -2, fontSize: 11, fill: '#6b7280' }}
                        />
                        <YAxis
                            dataKey="residual"
                            name="残差"
                            type="number"
                            tickFormatter={(v: number) => fmtNum(v, 0)}
                            label={{ value: '日残差（实际 − 基线）', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6b7280' }}
                        />
                        <Tooltip
                            cursor={{ strokeDasharray: '3 3' }}
                            formatter={(v: unknown, name: unknown) => {
                                if (name === '残差') return [`${fmtNum(Number(v), 1)} 单`, String(name)];
                                return [`${fmtNum(Number(v), 2)}%`, String(name)];
                            }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                        <Scatter
                            data={baselineDaily.map((d) => ({
                                date: d.date.slice(5),
                                discountRate: d.discountRate,
                                residual: d.residual,
                            }))}
                            name="每日残差"
                            fill={CHART_COLORS[5]}
                        />
                    </ScatterChart>
                </ResponsiveContainer>

                {/* Critical caveats */}
                <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
                    <div className="bg-amber-50 border border-amber-200 rounded p-3 text-amber-800">
                        <strong>残差 ≠ 折扣效果：</strong>实际超出无折扣基线的部分称为「超额订单」，但<strong>不能全部归因于折扣</strong>。模型未纳入活动、平台流量、新品、库存、价格弹性、营销日历等变量；评估窗口 WAPE {fmtPct((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).wape * 100)}，MAE {fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).mae, 2)} 单/日，说明基线本身<strong>系统性低估</strong>（bias +{fmtNum((baselineSnap?.overall ?? FALLBACK_BASELINE.overall).bias, 2)} 单/日）。
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded p-3 text-blue-800">
                        <strong>口径与限制：</strong>① 天气使用<strong>事后实际观测</strong>，仅适合事后评估，真正预测请改用当时天气预报；② 评估仅 46 天（6/1–7/16），单门店 sh_xtd；③ 模型公式 <code className="text-[10px]">{baselineSnap?.formula || "(公式详见建模脚本)"}</code>；④ 负二项过度离散参数 α = {fmtNum(baselineSnap?.alpha ?? 0, 4)}，说明模型允许订单方差高于均值；置信区间和完整结果见建模脚本输出。
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
