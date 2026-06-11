// ui/src/lib/admin-stores.ts
// Pure-function guards + DB lookups for the create_store admin/MCP path.
// Pure guards (§2.1) live below; DB queries (§3.2) live at the bottom.
// Regexes + error codes per docs/superpowers/specs/2026-06-08-agent-create-store-design.md §2.1.
// The whitelist is the security valve (§5.4) — `rule_snapshot_tables` must be a bare,
// whitelisted identifier; schema-qualified names and system tables are rejected.
import pool from '@/lib/db';
import type { UserRole } from '@/lib/auth-server';

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

/**
 * Look up a single store by `store_code` across ALL brands. Used by the
 * create_store source-validation path to distinguish three failure modes
 * (spec §2.1): `source_store_not_found` (no row), `source_store_brand_mismatch`
 * (row exists under a different brand), and `source_store_disabled`
 * (row exists in the same brand but `enabled = false`).
 */
export async function queryStoreAcrossBrands(
  storeCode: string,
): Promise<{ brand: string; enabled: boolean } | null> {
  const { rows } = await pool.query<{ brand: string; enabled: boolean }>(
    `SELECT brand_code AS brand, enabled
     FROM ops.stores WHERE store_code = $1`,
    [storeCode],
  );
  return rows[0] ?? null;
}

/**
 * Returns true iff `column` exists on `${schema}.${table}` in the live DB.
 * Used to detect whether a cfg table is store-scoped (has store_code column)
 * or brand-shared (lacks it). Both schema and table are expected to be
 * identifier-safe (regex-validated by assertBrandCode + isWhitelistedRuleSnapshotTable),
 * so identifier interpolation is safe here — parameterized form would break this SQL.
 */
export async function columnExists(client: any, schema: string, table: string, column: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
    [schema, table, column],
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// handleCreateStore (Tasks 3+4 — spec §3.2 / §3.3)
// Transactional create+update of ops.stores + {brand}_cfg.dim_store, with
// optional rule-snapshot copy from a same-brand sibling store.
// ---------------------------------------------------------------------------

export type Caller =
  | { kind: 'admin_ui'; user: { id: string; role: UserRole } }
  | { kind: 'mcp'; user: { id: string; role: UserRole }; serviceTokenMatched: boolean };

export interface CreateStoreInput {
  brand: string;
  store_code: string;
  store_name: string;
  rule_snapshot_source_store_code?: string;
  rule_snapshot_tables?: string[];
}

export interface RuleSnapshotSkipped {
  table: string;
  reason: string;
}

export interface RuleSnapshotCopied {
  table: string;
  rows_copied: number;
}

export interface RuleSnapshotResult {
  applied: boolean;
  source_store_code?: string;
  tables_copied: RuleSnapshotCopied[];
  tables_skipped: RuleSnapshotSkipped[];
  skipped_reason?: string;
}

export interface CreateStoreResult {
  ok: true;
  store: StoreRow & { updated: boolean };
  rule_snapshot?: RuleSnapshotResult;
}

export async function handleCreateStore(
  input: CreateStoreInput,
  caller: Caller,
): Promise<CreateStoreResult> {
  assertBrandCode(input.brand);
  assertStoreCode(input.store_code);
  assertStoreName(input.store_name);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (caller.user.role !== 'admin') {
      throw new ValidationError('forbidden');
    }
    if (caller.kind === 'mcp' && !caller.serviceTokenMatched) {
      throw new ValidationError('forbidden_mcp');
    }

    const { rows: brandRows } = await client.query<{ enabled: boolean }>(
      `SELECT enabled FROM ops.brands WHERE brand_code = $1`,
      [input.brand],
    );
    if (brandRows.length === 0) {
      throw new ValidationError('brand_not_found');
    }
    if (!brandRows[0].enabled) {
      throw new ValidationError('brand_disabled');
    }
    if (!(await queryCfgSchemaAllowed(input.brand))) {
      throw new ValidationError('cfg_schema_not_allowed');
    }

    const auditUser = caller.kind === 'mcp'
      ? `mcp:create_store:${input.store_code}`
      : `admin:${caller.user.id}`;
    await client.query(`SELECT set_config('wdg.user', $1, true)`, [auditUser]);

    const insertOps = await client.query<StoreRow & { is_insert: boolean }>(
      `INSERT INTO ops.stores (brand_code, store_code, store_name, enabled)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (brand_code, store_code) DO UPDATE
         SET store_name = EXCLUDED.store_name
       RETURNING brand_code AS brand, store_code, store_name, enabled,
                 (xmax = 0) AS is_insert`,
      [input.brand, input.store_code, input.store_name],
    );
    const storeRow = insertOps.rows[0];
    const updated = !storeRow.is_insert;

    const cfgSchema = `${input.brand}_cfg`;
    // ${cfgSchema} is regex-validated by assertBrandCode (^[a-z][a-z0-9_]{1,31}$),
    // so it's a safe identifier — Postgres rejects non-identifiers as schema names.
    // Do NOT parameterize; parameterized form would break this SQL.
    await client.query(
      `INSERT INTO ${cfgSchema}.dim_store (store_code, store_name)
       VALUES ($1, $2)
       ON CONFLICT (store_code) DO UPDATE
         SET store_name = EXCLUDED.store_name`,
      [input.store_code, input.store_name],
    );

    let rule_snapshot: RuleSnapshotResult;
    if (input.rule_snapshot_source_store_code) {
      if (updated) {
        rule_snapshot = { applied: false, tables_copied: [], tables_skipped: [], source_store_code: input.rule_snapshot_source_store_code };
        rule_snapshot.skipped_reason = 'store_already_existed';
      } else {
        const tables = input.rule_snapshot_tables ?? ['bank_rule_map'];
        for (const t of tables) {
          if (!isWhitelistedRuleSnapshotTable(t)) {
            throw new ValidationError('unknown_rule_snapshot_table', `table: ${t}`);
          }
        }
        const sourceRow = await queryStoreAcrossBrands(input.rule_snapshot_source_store_code);
        if (!sourceRow) throw new ValidationError('source_store_not_found');
        if (sourceRow.brand !== input.brand) throw new ValidationError('source_store_brand_mismatch');
        if (!sourceRow.enabled) throw new ValidationError('source_store_disabled');
        rule_snapshot = { applied: true, source_store_code: input.rule_snapshot_source_store_code, tables_copied: [], tables_skipped: [] };
        for (const table of tables) {
          const hasStoreCodeCol = await columnExists(client, cfgSchema, table, 'store_code');
          if (!hasStoreCodeCol) {
            rule_snapshot.tables_skipped.push({ table, reason: 'brand_level_shared_table_not_supported_in_v1' });
            continue;
          }
          rule_snapshot.tables_skipped.push({ table, reason: 'store_code_column_present_but_not_implemented_in_v1' });
        }
      }
    } else {
      rule_snapshot = { applied: false, tables_copied: [], tables_skipped: [] };
    }

    await client.query('COMMIT');
    return {
      ok: true,
      store: {
        brand: storeRow.brand,
        store_code: storeRow.store_code,
        store_name: storeRow.store_name,
        enabled: storeRow.enabled,
        updated,
      },
      rule_snapshot,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
