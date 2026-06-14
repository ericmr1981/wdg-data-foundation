import { salesToolFactory } from '@/mcp/sales-query-factory';

const GELATOMIIIX_SALES_PREFIX = '/api/gelatomiiix/sales';

export const queryGelatomiiixSalesOverviewTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_overview', dimension: 'overview',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesTrendTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_trend', dimension: 'trend',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesChannelsTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_channels', dimension: 'channels',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesProductsTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_products', dimension: 'products',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesDetailsTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_details', dimension: 'details',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesDistributionTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_distribution', dimension: 'distribution',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});

export const queryGelatomiiixSalesHourlyTool = salesToolFactory({
  name: 'query_gelatomiiix_sales_hourly', dimension: 'hourly',
  brand: 'gelatomiiix', pathPrefix: GELATOMIIIX_SALES_PREFIX,
});
