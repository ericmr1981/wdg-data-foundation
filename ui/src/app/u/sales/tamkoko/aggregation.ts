// ui/src/app/u/sales/tamkoko/aggregation.ts
// 多店前端聚合纯函数:无 React 依赖,可单测
import { STORES } from './stores';

export interface OverviewRow {
    store_code: string; month: string; gross_amt: string; revenue_amt: string;
    net_amt: string; discount_amt: string; qty: string; order_cnt: string;
    cash_in_rate: string; profit_rate: string; avg_order_amt: string;
    cash_in_rate_pct: string; prev_gross_amt: string | null;
}

export type TrendMetric = 'gross_amt' | 'revenue_amt' | 'cash_in_rate' | 'order_cnt';

export type TrendByStoreRow = { month: string } & Record<string, number>;

export type DimByStoreRow = Record<string, string | number>;

function num(v: string | null | undefined): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** SUM 各店 KPI,rate 类重算(SUM 分子 / SUM 分母),非平均 */
export function aggregateKpiTotal(rows: OverviewRow[]): OverviewRow {
    const gross = rows.reduce((a, r) => a + num(r.gross_amt), 0);
    const revenue = rows.reduce((a, r) => a + num(r.revenue_amt), 0);
    const net = rows.reduce((a, r) => a + num(r.net_amt), 0);
    const discount = rows.reduce((a, r) => a + num(r.discount_amt), 0);
    const qty = rows.reduce((a, r) => a + num(r.qty), 0);
    const orderCnt = rows.reduce((a, r) => a + num(r.order_cnt), 0);
    const cashInRate = gross > 0 ? revenue / gross : 0;
    return {
        store_code: 'all', month: rows[0]?.month ?? '',
        gross_amt: String(gross),
        revenue_amt: String(revenue),
        net_amt: String(net),
        discount_amt: String(discount),
        qty: String(qty),
        order_cnt: String(orderCnt),
        cash_in_rate: String(cashInRate),
        profit_rate: String(gross > 0 ? net / gross : 0),
        avg_order_amt: String(orderCnt > 0 ? gross / orderCnt : 0),
        cash_in_rate_pct: String(cashInRate * 100),
        prev_gross_amt: null,
    } as OverviewRow;
}

/** 按 (month, store) pivot 成多线趋势数据;空月/空店填 0 */
export function pivotTrendByStore(
    rows: OverviewRow[],
    metric: TrendMetric,
    fixedMonths: string[],
): TrendByStoreRow[] {
    const byMonth = new Map<string, TrendByStoreRow>();
    for (const m of fixedMonths) byMonth.set(m, { month: m } as TrendByStoreRow);
    for (const r of rows) {
        const m = String(r.month).slice(0, 7);
        if (!byMonth.has(m)) byMonth.set(m, { month: m } as TrendByStoreRow);
        const row = byMonth.get(m)!;
        // cash_in_rate 在 overview 是 0-1 小数,趋势统一转 0-100 显示
        const val = metric === 'cash_in_rate' ? num(r.cash_in_rate) * 100 : num(r[metric]);
        row[r.store_code] = val;
    }
    // 确保所有店 key 存在(无数据填 0)
    const out = fixedMonths.map(m => {
        const row = byMonth.get(m)!;
        for (const s of STORES) if (row[s.code] === undefined) row[s.code] = 0;
        return row;
    });
    return out;
}

/** 按 (dim_value, store) pivot 成分组柱数据 */
export function pivotDimByStore<T extends Record<string, unknown>>(
    rows: T[],
    dimKey: keyof T,
    valueKey: keyof T,
): DimByStoreRow[] {
    const byDim = new Map<string, DimByStoreRow>();
    for (const r of rows) {
        const d = String(r[dimKey] ?? '未分类');
        if (!byDim.has(d)) {
            const init: DimByStoreRow = { [String(dimKey)]: d };
            for (const s of STORES) init[s.code] = 0;
            byDim.set(d, init);
        }
        const storeCode = String(r.store_code ?? '');
        byDim.get(d)![storeCode] = num(String(r[valueKey] ?? '0'));
    }
    return Array.from(byDim.values());
}
