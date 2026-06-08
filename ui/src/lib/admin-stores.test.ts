// ui/src/lib/admin-stores.test.ts
import { test } from 'node:test';
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
