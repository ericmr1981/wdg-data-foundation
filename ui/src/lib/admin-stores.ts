// ui/src/lib/admin-stores.ts
// Pure-function guards for the create_store admin/MCP path.
// No DB, no I/O, no Next.js imports — safe for `node --test` and route handlers.
//
// Regexes + error codes per docs/superpowers/specs/2026-06-08-agent-create-store-design.md §2.1.
// The whitelist is the security valve (§5.4) — `rule_snapshot_tables` must be a bare,
// whitelisted identifier; schema-qualified names and system tables are rejected.

export const REQUIRED_BRAND_CODE_REGEX = /^[a-z][a-z0-9_]{1,31}$/;
export const REQUIRED_STORE_CODE_REGEX = /^[a-z][a-z0-9_]{1,31}$/;
export const REQUIRED_STORE_NAME_REGEX = /^[一-龥A-Za-z0-9\s\-_]{1,64}$/;

const WHITELIST = new Set<string>([
  'bank_rule_map',
  'dim_category_lvl1_override',
  'dim_category_lvl2_override',
]);

export class ValidationError extends Error {
  public readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.code = code;
    this.name = 'ValidationError';
  }
}

export function assertBrandCode(code: string): void {
  if (typeof code !== 'string' || !REQUIRED_BRAND_CODE_REGEX.test(code)) {
    throw new ValidationError('invalid_brand_code');
  }
}

export function assertStoreCode(code: string): void {
  if (typeof code !== 'string' || !REQUIRED_STORE_CODE_REGEX.test(code)) {
    throw new ValidationError('invalid_store_code');
  }
}

export function assertStoreName(name: string): void {
  if (typeof name !== 'string' || !REQUIRED_STORE_NAME_REGEX.test(name)) {
    throw new ValidationError('invalid_store_name');
  }
}

/**
 * Returns true iff `table` is a bare, whitelisted cfg-rule table name.
 * Rejects schema-qualified names (e.g. `ops.approval_proposal`) and any
 * system table not in the whitelist.
 */
export function isWhitelistedRuleSnapshotTable(table: string): boolean {
  if (typeof table !== 'string') return false;
  if (table.includes('.')) return false;
  return WHITELIST.has(table);
}
