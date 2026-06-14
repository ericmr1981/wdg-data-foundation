import { z } from 'zod';
import { assertApiSuccess } from '@/lib/api-error';

export type SalesDimension = 'overview' | 'trend' | 'channels' | 'products' | 'details' | 'distribution' | 'hourly';

export interface SalesToolConfig {
  name: string;
  dimension: SalesDimension;
  brand: string;
  pathPrefix: string; // e.g. '/api/gelatomiiix/sales'
  /** Override fetch for testing. Defaults to mcpFetch from @/lib/mcp-fetch (lazy-loaded). */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
}

const DIMENSION_DESCRIPTIONS: Record<SalesDimension, string> = {
  overview: 'sales overview (revenue / order count / avg ticket / payment method mix)',
  trend: 'sales 12-month trend (revenue / order count by month)',
  channels: 'sales channel breakdown (wechat / alipay / meituan / douyin / etc.)',
  products: 'product-level sales (SKU ranking by revenue / qty)',
  details: 'sales transaction details (paginated)',
  distribution: 'sales distribution (order-count / revenue-share by channel or time bucket)',
  hourly: 'sales hourly distribution (0-23h buckets, peak-hour analysis)',
};

const DIMENSION_PATH: Record<SalesDimension, string> = {
  overview: '/overview',
  trend: '/trend',
  channels: '/channels',
  products: '/products',
  details: '/details',
  distribution: '/distribution',
  hourly: '/hourly',
};

const baseSalesInput = {
  store_code: z.string().describe('Store code'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
  pure_mode: z.boolean().optional().default(false)
    .describe('If true, exclude membership / discount / refund transactions'),
};

// Lazily resolve mcpFetch so tests don't need to resolve the @/lib chain.
let _defaultFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;

async function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!_defaultFetch) {
    const mod = await import('@/lib/mcp-fetch');
    _defaultFetch = mod.mcpFetch;
  }
  return _defaultFetch(url, init);
}

export function salesToolFactory(config: SalesToolConfig) {
  const { name, dimension, brand, pathPrefix, fetchFn = defaultFetch } = config;
  const isDetails = dimension === 'details';

  const inputSchema = z.object({
    ...baseSalesInput,
    ...(isDetails ? {
      type: z.enum(['cash_register', 'qimai']).optional().default('cash_register')
        .describe('Detail source: cash_register (default) | qimai'),
      page: z.number().int().positive().optional().default(1).describe('Page number (default 1)'),
    } : {}),
  });

  type Params = z.infer<typeof inputSchema>;

  async function execute(params: Params) {
    const { store_code, month, pure_mode = false } = params;
    const qs = new URLSearchParams({ store_code, month });
    if (pure_mode) qs.set('pure_mode', 'true');
    if (isDetails) {
      const p = params as Params & { type?: string; page?: number };
      qs.set('type', p.type ?? 'cash_register');
      qs.set('page', String(p.page ?? 1));
    }

    const url = `${pathPrefix}${DIMENSION_PATH[dimension]}?${qs}`;
    const res = await fetchFn(url, { headers: { 'x-mcp-session': 'internal' } });

    const json = await assertApiSuccess(res, name);
    return (json as Record<string, unknown>).data;
  }

  return {
    name,
    description: `${brand} ${DIMENSION_DESCRIPTIONS[dimension]}`,
    inputSchema,
    execute,
  };
}
