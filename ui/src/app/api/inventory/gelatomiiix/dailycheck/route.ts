import { NextResponse } from 'next/server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';
import {
  listWarehouses,
  getTurnoverTop,
  getItemsList,
  DailyCheckUnavailableError,
  DailyCheckToolError,
} from '@/lib/dailycheck';
import type { InventoryItem } from '@/lib/dailycheck-types';
import type { DailyCheckBoardPayload } from '@/lib/dailycheck-types';

export const dynamic = 'force-dynamic';

const FIXED_WAREHOUSE_CODE = "wh_003";   // 蜜可诗供应链仓库 — 与 ops.stores store_code 对齐

export async function GET(req: Request) {
  try {
    const user = await getSessionUser(req);
    assertRole(user, ['admin', 'operator']);

    // 先列 warehouses 拿到 display name,顺便做 token 探活
    let whName = FIXED_WAREHOUSE_CODE;
    try {
      const list = await listWarehouses();
      const found = list.find((w) => w.code === FIXED_WAREHOUSE_CODE);
      whName = found?.name ?? FIXED_WAREHOUSE_CODE;
    } catch (e: unknown) {
      // 探活失败直接抛到外层 catch → 200 success=false
      throw e;
    }

    const items = await getItemsList(FIXED_WAREHOUSE_CODE);
    const turnoverResult = await getTurnoverTop(FIXED_WAREHOUSE_CODE, 20);
    const top_turnover = turnoverResult.items;
    const warehouse_turnover = turnoverResult.warehouse_turnover;

    // 总额 + 类别按「价值」(current_stock × unit_cost)计算,单位为元
    const total_stock = items.reduce(
      (acc, it) => acc + Number(it.current_stock ?? 0) * Number(it.unit_cost ?? 0),
      0
    );
    const catMap = new Map<string, number>();
    for (const it of items) {
      const name = (it as InventoryItem).category_name || `category_${(it as InventoryItem).category_id ?? 'unknown'}`;
      const value = Number(it.current_stock ?? 0) * Number(it.unit_cost ?? 0);
      catMap.set(name, (catMap.get(name) ?? 0) + value);
    }
    const categories = Array.from(catMap.entries())
      .map(([category, total_stock]) => ({ category, total_stock }))
      .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hans-CN'));

    const payload: DailyCheckBoardPayload = {
      warehouse_code: FIXED_WAREHOUSE_CODE,
      warehouse_name: whName,
      total_stock,
      categories,
      top_turnover,
      warehouse_turnover,
      fetched_at: new Date().toISOString(),
    };
    return NextResponse.json({ success: true, data: payload });
  } catch (e: unknown) {
    if (e instanceof DailyCheckUnavailableError || e instanceof DailyCheckToolError) {
      return NextResponse.json({
        success: false,
        error: 'dailycheck_unreachable',
        message: e.message,
      });
    }
    return NextResponse.json(
      { success: false, error: getErrorMessage(e) },
      { status: 500 }
    );
  }
}
