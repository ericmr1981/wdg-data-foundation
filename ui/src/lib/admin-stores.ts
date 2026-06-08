// ui/src/lib/admin-stores.ts
// Pure-function guards + DB lookups for the create_store admin/MCP path.
// Pure guards (§2.1) live below; DB queries (§3.2) live at the bottom.
// Regexes + error codes per docs/superpowers/specs/2026-06-08-agent-create-store-design.md §2.1.
// The whitelist is the security valve (§5.4) — `rule_snapshot_tables` must be a bare,
// whitelisted identifier; schema-qualified names and system tables are rejected.
// @ts-ignore
import pool from './db.ts';

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
  if (!REQUIRED_BRAND_CODE_REGEX.test(code)) {
    throw new ValidationError('invalid_brand_code');
  }
}

export function assertStoreCode(code: string): void {
  if (!REQUIRED_STORE_CODE_REGEX.test(code)) {
    throw new ValidationError('invalid_store_code');
  }
}

export function assertStoreName(name: string): void {
  if (!REQUIRED_STORE_NAME_REGEX.test(name)) {
    throw new ValidationError('invalid_store_name');
  }
}

/**
 * Returns true iff `table` is a bare, whitelisted cfg-rule table name.
 * Rejects schema-qualified names (e.g. `ops.approval_proposal`) and any
 * system table not in the whitelist.
 */
export function isWhitelistedRuleSnapshotTable(table: string): boolean {
  if (table.includes('.')) return false;
  return WHITELIST.has(table);
}

// ---------------------------------------------------------------------------
// DB lookups (spec §3.2 — transactional guards)
// Parameterized queries only. Used by /api/admin/stores create_store handler.
// ---------------------------------------------------------------------------

export interface StoreRow {
  brand: string;
  store_code: string;
  store_name: string;
  enabled: boolean;
}

/**
 * Returns true iff the brand is registered in `ops.brands` with `enabled = true`.
 */
export async function queryBrandEnabled(brand: string): Promise<boolean> {
  const { rows } = await pool.query<{ enabled: boolean }>(
    `SELECT enabled FROM ops.brands WHERE brand_code = $1`,
    [brand],
  );
  return rows[0]?.enabled ?? false;
}

/**
 * Returns true iff `${brand}_cfg` is registered in `ops.allowed_schemas`
 * with `enabled = true`. Gates cfg-schema writes for the create_store flow.
 */
export async function queryCfgSchemaAllowed(brand: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM ops.allowed_schemas WHERE schema_name = $1 AND enabled = true`,
    [`${brand}_cfg`],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Look up a single store by (brand_code, store_code). Returns null if absent.
 */
export async function queryStoreByCode(
  brand: string,
  storeCode: string,
): Promise<StoreRow | null> {
  const { rows } = await pool.query<StoreRow>(
    `SELECT brand_code AS brand, store_code, store_name, enabled
     FROM ops.stores WHERE brand_code = $1 AND store_code = $2`,
    [brand, storeCode],
  );
  return rows[0] ?? null;
}
