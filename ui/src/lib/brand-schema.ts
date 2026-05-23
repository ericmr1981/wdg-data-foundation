// Brand schema name utilities (pure functions, no DB dependency)
// These can be safely imported in client components

export type BrandCode = string;

function getSchemaPrefix(brand: BrandCode): string {
  // Legacy brands keep existing schema names: yufeng_* / bonjur_*
  // New brands use prefix: brand_<code>_
  const legacy = ['yufeng', 'bonjur', 'gelatomiiix'];
  return legacy.includes(brand) ? brand : `brand_${brand}`;
}

export function getDmSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_dm`;
}

export function getCfgSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_cfg`;
}

export function getOdsSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_ods`;
}

export function getOpsSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_ops`;
}

export function getDeliverySchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_delivery`;
}
