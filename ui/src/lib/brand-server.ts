// Dynamic brand mapping (C2)
// Legacy brands keep existing schema names: yufeng_* / bonjur_*
// New brands use prefix: brand_<code>_*

export type BrandCode = string;

export function normalizeBrand(input: string | null | undefined): BrandCode | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(v)) return null;
  return v;
}

export function getSchemaPrefix(brand: BrandCode): string {
  if (brand === 'yufeng' || brand === 'bonjur') return brand;
  return `brand_${brand}`;
}

export function getDmSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_dm`;
}

export function getCfgSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_cfg`;
}

export function getOpsSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_ops`;
}

export function getOdsSchema(brand: BrandCode): string {
  return `${getSchemaPrefix(brand)}_ods`;
}

export function getCfgRuleTable(brand: BrandCode): string {
  return `${getCfgSchema(brand)}.bank_rule_map`;
}

export function getOdsBankTxnTable(brand: BrandCode): string {
  return `${getOdsSchema(brand)}.bank_txn`;
}
