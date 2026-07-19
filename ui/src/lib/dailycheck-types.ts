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

export interface DailyCheckBoardPayload {
  warehouse_code: string;
  warehouse_name: string;
  total_stock: number;            // items_list current_stock 求和
  categories: CategoryBucket[];   // 9 类别
  top_turnover: ConsumptionRow[]; // warehouse_consumption top-20
  fetched_at: string;             // ISO 8601
}
