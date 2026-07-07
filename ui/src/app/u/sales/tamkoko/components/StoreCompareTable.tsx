// ui/src/app/u/sales/tamkoko/components/StoreCompareTable.tsx
'use client';

import { storeName } from '../stores';

export interface MultiStoreRow {
    store_code: string; month: string;
    gross_amt: string; revenue_amt: string; net_amt: string; qty: string;
    order_cnt: string; cash_in_rate: string; profit_rate: string;
    avg_order_amt: string; gross_rank_in_month: number;
    cash_in_rate_pct: string; profit_rate_pct: string;
}

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

export function StoreCompareTable({ rows }: { rows: MultiStoreRow[] }) {
    if (!rows || rows.length === 0) {
        return <div className="text-sm text-gray-400 py-4 text-center">暂无数据</div>;
    }
    const sorted = [...rows].sort((a, b) => a.gross_rank_in_month - b.gross_rank_in_month);
    return (
        <div className="overflow-x-auto">
            <h4 className="text-sm text-gray-500 mb-2">各店对比(按营业额排名)</h4>
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-gray-500">
                        <th>排名</th><th>门店</th><th>营业额</th><th>营业收入</th>
                        <th>实收率</th><th>订单数</th><th>客单价</th>
                    </tr>
                </thead>
                <tbody>
                    {sorted.map(r => (
                        <tr key={r.store_code} className="border-t">
                            <td className="py-1">#{r.gross_rank_in_month}</td>
                            <td>{storeName(r.store_code)}</td>
                            <td>{fmtNum(r.gross_amt, 2)}</td>
                            <td>{fmtNum(r.revenue_amt, 2)}</td>
                            <td>{fmtPct(Number(r.cash_in_rate) * 100, 2)}</td>
                            <td>{fmtNum(r.order_cnt)}</td>
                            <td>{fmtNum(r.avg_order_amt, 2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
