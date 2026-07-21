'use client';

import { useEffect, useState } from 'react';
import { DailyCheckErrorBanner } from './DailyCheckErrorBanner';
import type { DailyCheckBoardPayload } from '@/lib/dailycheck-types';

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: DailyCheckBoardPayload }
  | { status: 'error'; message: string };

export function DailyCheckBoard() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/inventory/gelatomiiix/dailycheck', { cache: 'no-store' });
        const body = await res.json();
        if (!alive) return;
        if (body.success) setState({ status: 'ok', data: body.data });
        else setState({ status: 'error', message: body.message ?? body.error ?? 'unknown error' });
      } catch (e: unknown) {
        if (!alive) return;
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (state.status === 'loading') {
    return <div className="text-xs text-gray-500 mb-4">DailyCheck 物料看板加载中…</div>;
  }
  if (state.status === 'error') {
    return <DailyCheckErrorBanner message={state.message} />;
  }
  const { warehouse_code, warehouse_name, total_stock, categories, top_turnover, warehouse_turnover, fetched_at } = state.data;

  return (
    <section className="mb-6">
      <header className="mb-2 flex items-baseline gap-3">
        <h2 className="text-lg font-semibold">DailyCheck 物料看板</h2>
        <span className="text-xs text-gray-500">
          仓库:{warehouse_name}({warehouse_code}) · 抓取于 {new Date(fetched_at).toLocaleTimeString('zh-CN')}
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-white rounded border p-4">
          <div className="text-xs text-gray-500">当前库存总额(金额 CNY)</div>
          <div className="text-2xl font-semibold tabular-nums">
            ¥{total_stock.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-white rounded border p-4">
          <div className="text-xs text-gray-500">总库存周转率({warehouse_turnover?.window_days ?? 30} 天)</div>
          <div className="text-2xl font-semibold tabular-nums">
            {warehouse_turnover && warehouse_turnover.turnover_value > 0
              ? `${warehouse_turnover.turnover_value.toFixed(2)} 次`
              : '-'}
          </div>
          {warehouse_turnover && warehouse_turnover.turnover_value > 0 && (
            <div className="text-xs text-gray-400 mt-1">
              COGS ¥{warehouse_turnover.warehouse_cogs_value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
              ÷ 平均库存 ¥{warehouse_turnover.warehouse_avg_inventory_value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}
              <br />
              锚点 {warehouse_turnover.items_with_turnover}/{warehouse_turnover.items_total} item ·
              质量 {warehouse_turnover.data_quality}
            </div>
          )}
        </div>
        <div className="bg-white rounded border p-4 md:col-span-1">
          <div className="text-xs text-gray-500 mb-1">类别分布(金额 CNY)</div>
          <table className="w-full text-xs">
            <thead><tr className="text-gray-500"><th className="text-left">类别</th><th className="text-right">金额</th></tr></thead>
            <tbody>
              {categories.length === 0 && (
                <tr><td colSpan={2} className="py-2 text-gray-400 text-center">无数据</td></tr>
              )}
              {categories.map((c) => (
                <tr key={c.category} className="border-t">
                  <td className="py-1">{c.category}</td>
                  <td className="py-1 text-right tabular-nums">
                    ¥{c.total_stock.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded border">
        <div className="px-3 py-2 text-xs text-gray-500 border-b">
          周转 Top-20(近 30 天,sort=turnover)
        </div>
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-2 py-1">#</th>
              <th className="px-2 py-1">SKU</th>
              <th className="px-2 py-1">名称</th>
              <th className="px-2 py-1">类别</th>
              <th className="px-2 py-1 text-right">当前库存</th>
              <th className="px-2 py-1 text-right">安全库存</th>
              <th className="px-2 py-1 text-right">消耗(30d)</th>
              <th className="px-2 py-1 text-right">日均</th>
              <th className="px-2 py-1 text-right">周转率</th>
            </tr>
          </thead>
          <tbody>
            {top_turnover.length === 0 && (
              <tr><td colSpan={9} className="px-2 py-3 text-center text-gray-400">暂无消耗记录</td></tr>
            )}
            {top_turnover.map((r) => (
              <tr key={r.item_id} className="border-t">
                <td className="px-2 py-1">{r.rank}</td>
                <td className="px-2 py-1">{r.sku}</td>
                <td className="px-2 py-1">{r.name}</td>
                <td className="px-2 py-1">{r.category}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.current_stock}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.safety_stock}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.consume_qty}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.daily_avg}</td>
                <td className="px-2 py-1 text-right tabular-nums">{r.turnover_rate.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
