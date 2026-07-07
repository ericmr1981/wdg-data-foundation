// ui/tests/tamkoko-aggregation.test.ts
// 注意:项目使用 node:test 运行器(非 Vitest),通过 `npx tsx --test <file>` 执行
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { aggregateKpiTotal, pivotTrendByStore, pivotDimByStore } from '../src/app/u/sales/tamkoko/aggregation';
import type { OverviewRow } from '../src/app/u/sales/tamkoko/aggregation';

const makeRow = (over: Partial<OverviewRow>): OverviewRow => ({
    store_code: 'sh_sjh', month: '2026-06-01',
    gross_amt: '0', revenue_amt: '0', net_amt: '0', discount_amt: '0',
    qty: '0', order_cnt: '0', cash_in_rate: '0', profit_rate: '0',
    avg_order_amt: '0', cash_in_rate_pct: '0', prev_gross_amt: null,
    ...over,
});

test('aggregateKpiTotal SUMs amounts across stores', () => {
    const rows = [
        makeRow({ gross_amt: '100', revenue_amt: '80', order_cnt: '10' }),
        makeRow({ gross_amt: '200', revenue_amt: '120', order_cnt: '20' }),
    ];
    const t = aggregateKpiTotal(rows);
    assert.equal(Number(t.gross_amt), 300);
    assert.equal(Number(t.revenue_amt), 200);
    assert.equal(Number(t.order_cnt), 30);
});

test('aggregateKpiTotal recomputes cash_in_rate as SUM(revenue)/SUM(gross), not average', () => {
    const rows = [
        makeRow({ gross_amt: '100', revenue_amt: '90' }),
        makeRow({ gross_amt: '300', revenue_amt: '150' }),
    ];
    const t = aggregateKpiTotal(rows);
    // SUM(rev)/SUM(gross) = 240/400 = 0.6;非 (0.9 + 0.5)/2 = 0.7
    assert.ok(Math.abs(Number(t.cash_in_rate) - 240 / 400) < 1e-5);
});

test('aggregateKpiTotal avg_order_amt = SUM(gross)/SUM(order_cnt)', () => {
    const t = aggregateKpiTotal([makeRow({ gross_amt: '300', order_cnt: '10' })]);
    assert.equal(Number(t.avg_order_amt), 30);
});

test('aggregateKpiTotal returns zero row for empty input', () => {
    const t = aggregateKpiTotal([]);
    assert.equal(Number(t.gross_amt), 0);
});

test('pivotTrendByStore pivots rows to {month, [store_code]: value}', () => {
    const fixedMonths = ['2026-05', '2026-06'];
    const rows = [
        makeRow({ store_code: 'sh_sjh', month: '2026-06-01', gross_amt: '100' }),
        makeRow({ store_code: 'hz_fuyang', month: '2026-06-01', gross_amt: '50' }),
    ];
    const out = pivotTrendByStore(rows, 'gross_amt', fixedMonths);
    assert.equal(out.length, 2);
    const jun = out.find(r => r.month === '2026-06')!;
    assert.equal(jun.sh_sjh, 100);
    assert.equal(jun.hz_fuyang, 50);
});

test('pivotTrendByStore fills missing months with zeros', () => {
    const fixedMonths = ['2026-05', '2026-06'];
    const out = pivotTrendByStore([], 'gross_amt', fixedMonths);
    assert.equal(out.length, 2);
    assert.equal(out[0].sh_sjh, 0);
});

test('pivotTrendByStore fills missing store in a month with 0', () => {
    const fixedMonths = ['2026-05', '2026-06'];
    const rows = [makeRow({ store_code: 'sh_sjh', month: '2026-06-01', gross_amt: '100' })];
    const jun = pivotTrendByStore(rows, 'gross_amt', fixedMonths).find(r => r.month === '2026-06')!;
    assert.equal(jun.hz_fuyang, 0); // hz 无数据 → 0
});

test('pivotDimByStore pivots channel rows to {order_source, [store_code]: gross_amt}', () => {
    const rows = [
        { store_code: 'sh_sjh', order_source: '美团外卖', gross_amt: '120' },
        { store_code: 'hz_fuyang', order_source: '美团外卖', gross_amt: '80' },
    ];
    const out = pivotDimByStore(rows, 'order_source', 'gross_amt');
    assert.equal(out.length, 1);
    assert.equal(out[0].order_source, '美团外卖');
    assert.equal(out[0].sh_sjh, 120);
    assert.equal(out[0].hz_fuyang, 80);
});
