// ui/src/lib/dailycheck.ts
// DailyCheck MCP 封装。协议细节见
// /Users/ericmr/Documents/GitHub/DailyCheck/docs/integrations/dailycheck-mcp/README.md

import './dailycheck-types';
import type {
  Warehouse,
  ConsumptionRow,
  CategoryBucket,
  WarehouseConsumptionResponse,
  WarehouseTurnover,
} from './dailycheck-types';

const URL = process.env.DAILYCHECK_URL || 'http://localhost:5100';
const TIMEOUT_MS = Number(process.env.DAILYCHECK_TIMEOUT_MS || '8000');

export class DailyCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DailyCheckUnavailableError';
  }
}

export class DailyCheckToolError extends Error {
  constructor(message: string, public readonly payload?: unknown) {
    super(message);
    this.name = 'DailyCheckToolError';
  }
}

let _tokenCache: { token: string } | null = null;

async function loadToken(): Promise<string> {
  if (_tokenCache) return _tokenCache.token;
  const raw = process.env.DAILYCHECK_MCP_TOKEN;
  if (!raw) throw new DailyCheckUnavailableError('DAILYCHECK_MCP_TOKEN not configured');
  _tokenCache = { token: raw };
  return raw;
}

// 仅供 ops.service_token 与 env 一致性检查;若需记录 last_used_at 可在路由层调一次。
// 本期不上 last_used_at 更新,留接口。

async function rpc(method: string, params?: object): Promise<unknown> {
  const token = await loadToken();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${URL}/api/mcp/`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    });
  } catch (e: unknown) {
    throw new DailyCheckUnavailableError(
      e instanceof Error ? `network: ${e.message}` : 'network error'
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new DailyCheckUnavailableError(`HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    jsonrpc?: string;
    error?: { code: number; message: string };
    result?: { isError?: boolean; content?: Array<{ type: string; text: string }> };
  };

  if (body.error) {
    throw new DailyCheckUnavailableError(`rpc ${body.error.code}: ${body.error.message}`);
  }
  if (body.result?.isError) {
    const txt = body.result.content?.[0]?.text ?? '';
    let parsed: { message?: string } = {};
    try { parsed = JSON.parse(txt); } catch { /* keep empty */ }
    throw new DailyCheckToolError(parsed.message ?? 'tool error', body.result);
  }
  return body.result;
}

// content[0].text 解析
async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = (await rpc('tools/call', { name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
  };
  const txt = res.content?.[0]?.text ?? '[]';
  return JSON.parse(txt) as T;
}

export async function callDailyCheckRpc(method: string, params?: object): Promise<unknown> {
  return rpc(method, params);
}

export async function listWarehouses(): Promise<Warehouse[]> {
  return callTool<Warehouse[]>('warehouse_list');
}

export async function getItemsList(whCode: string): Promise<Array<{ category_name: string; current_stock: number; unit_cost: number }>> {
  return callTool('items_list', { warehouse_code: whCode });
}

export async function getWarehouseTotal(whCode: string): Promise<number> {
  // 总库存价值 = Σ (current_stock × unit_cost),单位为元
  const items = await getItemsList(whCode);
  return items.reduce((acc, it) => acc + Number(it.current_stock ?? 0) * Number(it.unit_cost ?? 0), 0);
}

export async function getTurnoverTop(
  whCode: string,
  limit = 20,
): Promise<{ items: ConsumptionRow[]; warehouse_turnover: WarehouseTurnover }> {
  // DailyCheck warehouse_consumption 返回 { items, warehouse_turnover }
  const res = await callTool<WarehouseConsumptionResponse | ConsumptionRow[]>(
    'warehouse_consumption',
    {
      warehouse_code: whCode,
      days: 30,
      sort_by: 'turnover',
      limit,
    }
  );
  // 兼容旧的 array 形状 (DailyCheck 之前是直接返 array)
  if (Array.isArray(res)) {
    return {
      items: res,
      warehouse_turnover: {
        window_days: 30,
        warehouse_cogs_value: 0,
        warehouse_avg_inventory_value: 0,
        turnover_value: 0,
        items_with_turnover: 0,
        items_total: 0,
        data_quality: 'none',
        method: 'unavailable',
      },
    };
  }
  return {
    items: res.items ?? [],
    warehouse_turnover: res.warehouse_turnover ?? {
      window_days: 30,
      warehouse_cogs_value: 0,
      warehouse_avg_inventory_value: 0,
      turnover_value: 0,
      items_with_turnover: 0,
      items_total: 0,
      data_quality: 'none',
      method: 'unavailable',
    },
  };
}

export async function getCategoryDistribution(whCode: string): Promise<CategoryBucket[]> {
  const items = await getItemsList(whCode);
  const map = new Map<string, number>();
  for (const it of items) {
    const name = it.category_name || `category_${it.category_id ?? 'unknown'}`;
    // 类别价值 = Σ (current_stock × unit_cost)
    const value = Number(it.current_stock ?? 0) * Number(it.unit_cost ?? 0);
    map.set(name, (map.get(name) ?? 0) + value);
  }
  return Array.from(map.entries())
    .map(([category, total_stock]) => ({ category, total_stock }))
    .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hans-CN'));
}

// 缓存清理(测试用)
export function __resetDailyCheckTokenCache(): void { _tokenCache = null; }
