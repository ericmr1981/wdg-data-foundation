// ui/src/app/u/sales/tamkoko/components/GroupedBarChart.tsx
'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { STORES } from '../stores';

const fmtNum = (v: unknown, digits = 0): string => {
    const n = Number(v);
    if (!Number.isFinite(n)) return '-';
    return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

interface Props {
    data: Array<Record<string, string | number>>;
    xKey: string;
    height?: number;
    xTickFormatter?: (v: string) => string;
}

/** 通用分组柱:X 轴=xKey,每店一个 Bar 并排 */
export function GroupedBarChart({ data, xKey, height = 240, xTickFormatter }: Props) {
    if (!data || data.length === 0) {
        return <div className="text-sm text-gray-400 py-4 text-center">暂无数据</div>;
    }
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey={xKey} tickFormatter={xTickFormatter ? (v => xTickFormatter(String(v))) : undefined} />
                <YAxis tickFormatter={(v: number) => fmtNum(v, 0)} />
                <Tooltip formatter={(v: unknown) => fmtNum(v, 2)} />
                <Legend />
                {STORES.map(s => (
                    <Bar key={s.code} dataKey={s.code} name={s.name} fill={s.color} />
                ))}
            </BarChart>
        </ResponsiveContainer>
    );
}
