export const BRAND_CODES = ['yufeng', 'bonjur'] as const;
export type BrandCode = (typeof BRAND_CODES)[number];

export function normalizeBrand(input: string | null | undefined): BrandCode | null {
  if (!input) return null;
  return (BRAND_CODES as readonly string[]).includes(input) ? (input as BrandCode) : null;
}

export function getDmSchema(brand: BrandCode): string {
  if (brand === 'yufeng') return 'yufeng_dm';
  if (brand === 'bonjur') return 'bonjur_dm';
  // exhaustive
  throw new Error(`Unsupported brand: ${brand}`);
}

export function getCfgSchema(brand: BrandCode): string {
  if (brand === 'yufeng') return 'yufeng_cfg';
  if (brand === 'bonjur') return 'bonjur_cfg';
  throw new Error(`Unsupported brand: ${brand}`);
}

export function getOpsSchema(brand: BrandCode): string {
  if (brand === 'yufeng') return 'yufeng_ops';
  if (brand === 'bonjur') return 'bonjur_ops';
  throw new Error(`Unsupported brand: ${brand}`);
}

export function getCfgRuleTable(brand: BrandCode): string {
  if (brand === 'yufeng') return 'yufeng_cfg.bank_rule_map';
  if (brand === 'bonjur') return 'bonjur_cfg.bank_rule_map';
  throw new Error(`Unsupported brand: ${brand}`);
}

export function getOdsBankTxnTable(brand: BrandCode): string {
  if (brand === 'yufeng') return 'yufeng_ods.bank_txn';
  if (brand === 'bonjur') return 'bonjur_ods.bank_txn';
  throw new Error(`Unsupported brand: ${brand}`);
}
