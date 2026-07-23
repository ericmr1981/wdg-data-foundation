'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

const fmtNum = (v: unknown): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN');
};

interface BrandKpi {
    gross_amt: number;
    order_cnt: number;
    cash_in_rate_pct: number;
    avg_order_amt: number;
    month: string;
    store: string;
}

const BRANDS = [
    { code: 'gelatomiiix', name: '蜜可诗', store: 'sh_xtd', storeName: '上海新天地店', month: '2026-07-01', color: 'from-orange-400 to-pink-500' },
    { code: 'bonjur', name: '旺鼎阁', store: 'wz_wxc', storeName: '温州万象城', month: '2026-05-01', color: 'from-amber-500 to-red-600' },
    { code: 'tamkoko', name: '泰柯茶园', store: 'sh_sjh', storeName: '上海世纪汇店', month: '2026-06-01', color: 'from-emerald-400 to-teal-600' },
];

export default function SalesOverviewPage() {
    const [kpis, setKpis] = useState<Record<string, BrandKpi | null>>({});
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        Promise.all(BRANDS.map(async (b) => {
            try {
                const base = b.code === 'tamkoko' ? '/api/tamkoko/sales' : `/api/${b.code}/sales`;
                const r = await fetch(`${base}/overview?store=${b.store}&month=${b.month}`);
                const j = await r.json();
                if (j.success && j.data) {
                    const row = Array.isArray(j.data) ? j.data[0] : j.data;
                    if (row) {
                        return { code: b.code, data: {
                            gross_amt: Number(row.gross_amt) || 0,
                            order_cnt: Number(row.order_cnt) || 0,
                            cash_in_rate_pct: Number(row.cash_in_rate_pct || row.cash_in_rate) || 0,
                            avg_order_amt: Number(row.avg_order_amt) || 0,
                            month: String(row.month || b.month).slice(0, 7),
                            store: b.storeName,
                        }};
                    }
                }
            } catch {}
            return { code: b.code, data: null };
        })).then(results => {
            const map: Record<string, BrandKpi | null> = {};
            for (const r of results) map[r.code] = r.data;
            setKpis(map);
            setLoading(false);
        });
    }, []);

    if (loading) {
        return <div className="p-12 text-center text-gray-400">加载中...</div>;
    }

    return (
        <div className="p-6 max-w-6xl mx-auto space-y-6">
            <h1 className="text-2xl font-bold">销售总览</h1>
            <div className="grid grid-cols-3 gap-6">
                {BRANDS.map(b => {
                    const k = kpis[b.code];
                    return (
                        <Link key={b.code} href={`/u/sales/${b.code}`}
                            className="group block bg-white border rounded-xl overflow-hidden hover:shadow-lg transition-shadow">
                            {/* Header gradient */}
                            <div className={`bg-gradient-to-r ${b.color} px-5 py-4`}>
                                <div className="text-lg font-bold text-white">{b.name}</div>
                                <div className="text-xs text-white/70">{b.storeName}</div>
                            </div>
                            {/* KPI rows */}
                            <div className="px-5 py-4 space-y-2">
                                {k ? (<>
                                    <KpiRow label="当月" value={k.month} />
                                    <KpiRow label="营业额" value={`¥${fmtNum(k.gross_amt)}`} />
                                    <KpiRow label="订单数" value={fmtNum(k.order_cnt)} bold />
                                    <KpiRow label="实收率" value={`${k.cash_in_rate_pct.toFixed(1)}%`} />
                                    <KpiRow label="客单价" value={`¥${fmtNum(k.avg_order_amt)}`} />
                                </>) : (
                                    <div className="text-sm text-gray-400 py-2">暂无数据</div>
                                )}
                            </div>
                            <div className="px-5 py-3 bg-gray-50 border-t text-sm text-gray-500 group-hover:text-blue-600 text-center">
                                查看详情 →
                            </div>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}

function KpiRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
    return (
        <div className="flex justify-between text-sm">
            <span className="text-gray-500">{label}</span>
            <span className={bold ? 'font-semibold' : 'text-gray-700'}>{value}</span>
        </div>
    );
}
