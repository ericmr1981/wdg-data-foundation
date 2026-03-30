// Dynamic brand mapping (C2)
// Legacy brands keep existing schema names: yufeng_* / bonjur_*
// New brands use prefix: brand_<code>_

import pool from '@/lib/db';

export type BrandCode = string;

// ── Schema whitelist (loaded once, cached in-module) ──
let _schemaCache: Set<string> | null = null;
let _schemaCacheTs = 0;
const SCHEMA_CACHE_TTL_MS = 60_000; // 1 minute

export function normalizeBrand(input: string | null | undefined): BrandCode | null {
  if (!input) return null;
  const v = String(input).trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(v)) return null;
  return v;
}

/**
 * Check whether a schema name is in the ops.allowed_schemas whitelist.
 * Uses a 1-minute in-process cache to avoid hammering the DB.
 */
export async function isAllowedSchema(schema: string): Promise<boolean> {
  const now = Date.now();
  if (!_schemaCache || now - _schemaCacheTs > SCHEMA_CACHE_TTL_MS) {
    try {
      const res = await pool.query('SELECT schema_name FROM ops.allowed_schemas WHERE enabled = true');
      _schemaCache = new Set(res.rows.map((r: any) => r.schema_name));
      _schemaCacheTs = now;
    } catch {
      // If the table doesn't exist yet, fail open (return false) so the
      // caller still gets a proper DB error rather than a silent bypass.
      _schemaCache = new Set();
      _schemaCacheTs = now;
    }
  }
  return _schemaCache.has(schema);
}

/**
 * Validate a brand code against the whitelist, then return its dm schema.
 * Throws a 400 if the schema is not in allowed_schemas.
 */
export async function getDmSchemaSafe(brand: BrandCode): Promise<string> {
  const schema = getDmSchema(brand);
  if (!(await isAllowedSchema(schema))) {
    throw Object.assign(new Error(`Schema not allowed: ${schema}`), { status: 400 });
  }
  return schema;
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
