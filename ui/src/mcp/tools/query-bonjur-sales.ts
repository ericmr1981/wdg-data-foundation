import { salesToolFactory } from '@/mcp/sales-query-factory';

const BONJUR_SALES_PREFIX = '/api/bonjur/sales';

export const queryBonjurSalesProductsTool = salesToolFactory({
  name: 'query_bonjur_sales_products', dimension: 'products',
  brand: 'bonjur', pathPrefix: BONJUR_SALES_PREFIX,
});

export const queryBonjurSalesDetailsTool = salesToolFactory({
  name: 'query_bonjur_sales_details', dimension: 'details',
  brand: 'bonjur', pathPrefix: BONJUR_SALES_PREFIX,
});
