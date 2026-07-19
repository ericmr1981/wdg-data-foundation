// ui/src/lib/dailycheck.ts
// DailyCheck MCP 封装。协议细节见
// /Users/ericmr/Documents/GitHub/DailyCheck/docs/integrations/dailycheck-mcp/README.md

import './dailycheck-types';
import type { Warehouse, ConsumptionRow, CategoryBucket } from './dailycheck-types';

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

export async function getWarehouseTotal(whCode: string): Promise<number> {
  const items = await callTool<Array<{ current_stock: number }>>('items_list', { warehouse_code: whCode });
  return items.reduce((acc, it) => acc + Number(it.current_stock ?? 0), 0);
}

export async function getTurnoverTop(whCode: string, limit = 20): Promise<ConsumptionRow[]> {
  return callTool<ConsumptionRow[]>('warehouse_consumption', {
    warehouse_code: whCode,
    days: 30,
    sort_by: 'turnover',
    limit,
  });
}

export async function getCategoryDistribution(whCode: string): Promise<CategoryBucket[]> {
  const items = await callTool<Array<{ category: string; current_stock: number }>>(
    'items_list', { warehouse_code: whCode },
  );
  const map = new Map<string, number>();
  for (const it of items) {
    map.set(it.category, (map.get(it.category) ?? 0) + Number(it.current_stock ?? 0));
  }
  return Array.from(map.entries())
    .map(([category, total_stock]) => ({ category, total_stock }))
    .sort((a, b) => a.category.localeCompare(b.category, 'zh-Hans-CN'));
}

// 缓存清理(测试用)
export function __resetDailyCheckTokenCache(): void { _tokenCache = null; }
