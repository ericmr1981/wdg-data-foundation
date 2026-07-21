// DailyCheck MCP 返回类型 — 见 DailyCheck docs/integrations/dailycheck-mcp/tools.json
// 这些是 DailyCheck 返回字段的窄化(只读我们关心的部分)。

export interface Warehouse {
  code: string;
  name: string;
}

export interface ConsumptionRow {
  rank: number;
  item_id: number;
  sku: string;
  name: string;
  category: string;            // DailyCheck 9 固定类别之一
  unit: string;
  current_stock: number;
  safety_stock: number;
  consume_qty: number;
  consume_days: number;
  daily_avg: number;
  turnover_rate: number;
  consume_pct: number;
  first_date: string | null;
  last_date: string | null;
}

export interface CategoryBucket {
  category: string;
  total_stock: number;
}

// 仓库级 turnover (DailyCheck warehouse_consumption 返回,
// Σ(per-item turnover) 加权汇总,采用 stocktake 锚点的加权平均法)
export interface WarehouseTurnover {
  window_days: number;
  warehouse_cogs_value: number;
  warehouse_avg_inventory_value: number;
  turnover_value: number;
  items_with_turnover: number;
  items_total: number;
  data_quality: 'high' | 'medium' | 'low' | 'none';
  method: string;
}

// warehouse_consumption 新返回值结构
export interface WarehouseConsumptionResponse {
  items: ConsumptionRow[];
  warehouse_turnover: WarehouseTurnover;
}

export interface DailyCheckBoardPayload {
  warehouse_code: string;
  warehouse_name: string;
  total_stock: number;            // items_list current_stock 求和(单位:元, 用 quantity × unit_cost)
  categories: CategoryBucket[];   // 9 类别
  top_turnover: ConsumptionRow[]; // warehouse_consumption top-20
  warehouse_turnover: WarehouseTurnover | null; // 仓库级 30 天周转率
  fetched_at: string;             // ISO 8601
}
