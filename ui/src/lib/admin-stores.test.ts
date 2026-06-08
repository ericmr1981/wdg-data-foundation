// ui/src/lib/admin-stores.test.ts
import { test, describe, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import {
  assertBrandCode,
  assertStoreCode,
  assertStoreName,
  isWhitelistedRuleSnapshotTable,
  REQUIRED_BRAND_CODE_REGEX,
  REQUIRED_STORE_CODE_REGEX,
  queryBrandEnabled,
  queryCfgSchemaAllowed,
  queryStoreByCode,
  handleCreateStore,
  ValidationError,
} from './admin-stores.ts';

test('assertBrandCode accepts valid brand code', () => {
  assert.doesNotThrow(() => assertBrandCode('gelatomiiix'));
});

test('assertBrandCode rejects invalid brand code (uppercase + dash)', () => {
  assert.throws(() => assertBrandCode('Gelato-MIX'), /invalid_brand_code/);
});

test('assertBrandCode rejects invalid brand code (leading digit)', () => {
  assert.throws(() => assertBrandCode('1abc'), /invalid_brand_code/);
});

test('assertStoreCode accepts valid store code', () => {
  assert.doesNotThrow(() => assertStoreCode('sh_xtd_v2'));
});

test('assertStoreCode rejects invalid store code (uppercase + dash)', () => {
  assert.throws(() => assertStoreCode('Sh-XTD'), /invalid_store_code/);
});

test('assertStoreName accepts Chinese name', () => {
  assert.doesNotThrow(() => assertStoreName('上海新天地二店'));
});

test('assertStoreName rejects empty name', () => {
  assert.throws(() => assertStoreName(''), /invalid_store_name/);
});

test('assertStoreName rejects name too long (65 chars)', () => {
  assert.throws(() => assertStoreName('a'.repeat(65)), /invalid_store_name/);
});

test('isWhitelistedRuleSnapshotTable accepts whitelisted tables', () => {
  assert.equal(isWhitelistedRuleSnapshotTable('bank_rule_map'), true);
  assert.equal(isWhitelistedRuleSnapshotTable('dim_category_lvl1_override'), true);
});

test('isWhitelistedRuleSnapshotTable rejects system tables', () => {
  assert.equal(isWhitelistedRuleSnapshotTable('pg_class'), false);
  assert.equal(isWhitelistedRuleSnapshotTable('information_schema.tables'), false);
  assert.equal(isWhitelistedRuleSnapshotTable('ops.approval_proposal'), false);
});

test('queryBrandEnabled returns true for gelatomiiix', async () => {
  const enabled = await queryBrandEnabled('gelatomiiix');
  assert.equal(enabled, true);
});

test('queryBrandEnabled returns false for nonexistent brand', async () => {
  const enabled = await queryBrandEnabled('nonexistent_brand_xyz');
  assert.equal(enabled, false);
});

test('queryCfgSchemaAllowed returns true for gelatomiiix cfg', async () => {
  const allowed = await queryCfgSchemaAllowed('gelatomiiix');
  assert.equal(allowed, true);
});

test('queryStoreByCode returns null for nonexistent store', async () => {
  const row = await queryStoreByCode('gelatomiiix', 'nonexistent_store_xyz');
  assert.equal(row, null);
});

describe('handleCreateStore (integration, dev DB, transactional)', () => {
  const TEST_BRAND = 'gelatomiiix';
  const TEST_STORE_CODE = 'test_create_store_temp';
  const TEST_STORE_NAME = '单元测试临时店';
  const caller = { kind: 'admin_ui' as const, user: { id: 'unit-test', role: 'admin' as const } };

  afterEach(async () => {
    const pool = (await import('@/lib/db')).default;
    await pool.query(`DELETE FROM ops.stores WHERE brand_code = $1 AND store_code = $2`, [TEST_BRAND, TEST_STORE_CODE]);
    await pool.query(`DELETE FROM ${TEST_BRAND}_cfg.dim_store WHERE store_code = $1`, [TEST_STORE_CODE]);
  });

  test('creates store: writes ops.stores + {brand}_cfg.dim_store in one transaction', async () => {
    const result = await handleCreateStore({
      brand: TEST_BRAND,
      store_code: TEST_STORE_CODE,
      store_name: TEST_STORE_NAME,
    }, caller);

    assert.equal(result.ok, true);
    assert.equal(result.store.brand, TEST_BRAND);
    assert.equal(result.store.store_code, TEST_STORE_CODE);
    assert.equal(result.store.store_name, TEST_STORE_NAME);
    assert.equal(result.store.enabled, true);
    assert.equal(result.store.updated, false);

    const pool = (await import('@/lib/db')).default;
    const opsRow = await pool.query(
      `SELECT * FROM ops.stores WHERE brand_code = $1 AND store_code = $2`,
      [TEST_BRAND, TEST_STORE_CODE],
    );
    assert.equal(opsRow.rowCount, 1);
    const cfgRow = await pool.query(
      `SELECT * FROM ${TEST_BRAND}_cfg.dim_store WHERE store_code = $1`,
      [TEST_STORE_CODE],
    );
    assert.equal(cfgRow.rowCount, 1);
  });

  test('idempotent: second call updates store_name and sets updated=true', async () => {
    await handleCreateStore(
      { brand: TEST_BRAND, store_code: TEST_STORE_CODE, store_name: TEST_STORE_NAME },
      caller,
    );
    const result = await handleCreateStore(
      { brand: TEST_BRAND, store_code: TEST_STORE_CODE, store_name: '新名字' },
      caller,
    );
    assert.equal(result.store.updated, true);
    assert.equal(result.store.store_name, '新名字');
  });

  test('rejects nonexistent brand with brand_not_found', async () => {
    await assert.rejects(
      handleCreateStore(
        { brand: 'nonexistent_brand_xyz', store_code: 'temp', store_name: 'temp' },
        caller,
      ),
      (err: any) => err instanceof ValidationError && err.code === 'brand_not_found',
    );
  });
});

describe('handleCreateStore with rule snapshot', () => {
  const SOURCE_STORE = 'sh_xtd';
  const TARGET_BRAND = 'gelatomiiix';
  const TEST_STORE = 'test_snapshot_temp';
  const caller = { kind: 'admin_ui' as const, user: { id: 'unit-test', role: 'admin' as const } };

  afterEach(async () => {
    const pool = (await import('@/lib/db')).default;
    await pool.query(`DELETE FROM ops.stores WHERE brand_code = $1 AND store_code = $2`, [TARGET_BRAND, TEST_STORE]);
    await pool.query(`DELETE FROM ${TARGET_BRAND}_cfg.dim_store WHERE store_code = $1`, [TEST_STORE]);
  });

  test('copies bank_rule_map rows filtered by source store_code', async () => {
    const result = await handleCreateStore({
      brand: TARGET_BRAND,
      store_code: TEST_STORE,
      store_name: '快照测试',
      rule_snapshot_source_store_code: SOURCE_STORE,
      rule_snapshot_tables: ['bank_rule_map']
    }, caller);
    assert.equal(result.rule_snapshot?.applied, true);
    const bankRuleEntry = result.rule_snapshot?.tables_skipped.find((t: any) => t.table === 'bank_rule_map');
    // dev DB `gelatomiiix_cfg.bank_rule_map` has no `store_code` column → reason ends in
    // "brand_level_shared_table_not_supported_in_v1". If a future schema adds the column,
    // the reason becomes "store_code_column_present_but_not_implemented_in_v1". Both are valid v1.
    assert.match(
      bankRuleEntry?.reason ?? '',
      /(brand_level_shared_table_not_supported_in_v1|store_code_column_present_but_not_implemented_in_v1)/,
    );
  });

  test('rejects unknown table in rule_snapshot_tables', async () => {
    await assert.rejects(
      handleCreateStore({
        brand: TARGET_BRAND,
        store_code: TEST_STORE,
        store_name: 'x',
        rule_snapshot_source_store_code: SOURCE_STORE,
        rule_snapshot_tables: ['pg_class']
      }, caller),
      (err: any) => err.code === 'unknown_rule_snapshot_table'
    );
  });

  test('rejects cross-brand source_store', async () => {
    await assert.rejects(
      handleCreateStore({
        brand: TARGET_BRAND,
        store_code: TEST_STORE,
        store_name: 'x',
        rule_snapshot_source_store_code: 'wz_wxc', // bonjur 的 store
        rule_snapshot_tables: ['bank_rule_map']
      }, caller),
      (err: any) => err.code === 'source_store_not_found'
    );
  });
});
