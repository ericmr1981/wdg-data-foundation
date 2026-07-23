import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const baseInput = {
  store_code: z.string().describe('Store code, e.g. sh_xtd'),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Month in YYYY-MM format'),
  pure_mode: z.boolean().optional().default(false)
    .describe('If true, exclude orders with NULL payment_method (純淨銷售)'),
};

function qs(p: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'pure_mode') { u.set('exclude_other', 'true'); continue; }
    u.set(k, String(v));
  }
  return u.toString();
}

// ─── 月度 KPI ───
export const queryGelatomiiixSalesOverviewTool = {
  name: 'query_gelatomiiix_sales_overview',
  description: 'Gelatomiiix monthly KPI: gross/revenue/discount/net amounts, order count, cash-in rate, avg ticket, MoM % change.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/overview?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 12月趋势 ───
export const queryGelatomiiixSalesTrendTool = {
  name: 'query_gelatomiiix_sales_trend',
  description: 'Gelatomiiix 12-month trend: monthly gross/revenue/net, order count, cash-in rate, avg ticket.',
  inputSchema: z.object({ store_code: baseInput.store_code, pure_mode: baseInput.pure_mode }),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/trend?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 渠道分布 ───
export const queryGelatomiiixSalesChannelsTool = {
  name: 'query_gelatomiiix_sales_channels',
  description: 'Gelatomiiix payment method breakdown: gross/revenue per channel (wechat/alipay/meituan/douyin/etc).',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/channel?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 堂食 vs 打包 ───
export const queryGelatomiiixSalesDineTakeawayTool = {
  name: 'query_gelatomiiix_sales_dine_takeaway',
  description: 'Gelatomiiix dine-in vs takeaway comparison: gross/revenue, order count per type.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/dine-takeaway?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 日级明细 ───
export const queryGelatomiiixSalesDailyTool = {
  name: 'query_gelatomiiix_sales_daily',
  description: 'Gelatomiiix daily KPI within a month: per-date gross/revenue/net, order count, avg ticket. month required.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/daily?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 商品排行 ───
export const queryGelatomiiixSalesProductsTool = {
  name: 'query_gelatomiiix_sales_products',
  description: 'Gelatomiiix product-level SKU ranking: top 10 by received amount, with qty/sales/received/discount.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/product?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 小时分析 ───
export const queryGelatomiiixSalesHourlyTool = {
  name: 'query_gelatomiiix_sales_hourly',
  description: 'Gelatomiiix hourly order/sales distribution (09~22 buckets). Useful for peak-hour analysis.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/hourly?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 支付方式日趋势 ───
export const queryGelatomiiixSalesChannelDailyTool = {
  name: 'query_gelatomiiix_sales_channel_daily',
  description: 'Gelatomiiix daily payment-channel breakdown within a month: gross/revenue/order_cnt per channel per day.',
  inputSchema: z.object(baseInput),
  async execute(params: Record<string, unknown>) {
    const res = await mcpFetch(`/api/gelatomiiix/sales/channel-daily?${qs(params)}`, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── 产品规格分析 ───
export const queryGelatomiiixSalesSpecTool = {
  name: 'query_gelatomiiix_sales_spec_analysis',
  description: 'Gelatomiiix product spec breakdown: 一级规格(e.g. 环保纸杯/华夫蛋筒/华夫碗) × 二级规格(标准/小杯) with sales/qty/received/discount. group_by=spec returns aggregated by spec, default returns per-product detail.',
  inputSchema: z.object({
    ...baseInput,
    group_by: z.enum(['spec', 'product']).optional().default('spec').describe('"spec" aggregates by spec_level1×spec_level2, "product" returns per-SKU rows'),
  }),
  async execute(params: Record<string, unknown>) {
    const groupBy = params.group_by || 'spec';
    const url = `/api/gelatomiiix/sales/product-analysis?${qs(params)}&group_by=${groupBy}`;
    const res = await mcpFetch(url, { headers: { 'x-mcp-session': 'internal' } });
    if (!res.ok) throw new Error(await res.text());
    const j = await res.json();
    if (!j.success) throw new Error(j.error || 'Unknown');
    return j.data;
  },
};

// ─── used by server.ts ───
const tools = [
  queryGelatomiiixSalesOverviewTool,
  queryGelatomiiixSalesTrendTool,
  queryGelatomiiixSalesChannelsTool,
  queryGelatomiiixSalesDineTakeawayTool,
  queryGelatomiiixSalesDailyTool,
  queryGelatomiiixSalesProductsTool,
  queryGelatomiiixSalesHourlyTool,
  queryGelatomiiixSalesChannelDailyTool,
  queryGelatomiiixSalesSpecTool,
];
export default tools;
