import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { BRAND_NAMES, brandParamSchema } from '../../src/lib/brand-param.ts';

test('accepts all current brand codes', () => {
  for (const code of BRAND_NAMES) {
    const result = brandParamSchema.safeParse(code);
    assert.ok(result.success, `should accept ${code}`);
  }
});

test('rejects yufeng (deprecated legacy code)', () => {
  const result = brandParamSchema.safeParse('yufeng');
  assert.equal(result.success, false);
});

test('rejects unknown brand', () => {
  const result = brandParamSchema.safeParse('unknown_brand_xyz');
  assert.equal(result.success, false);
});

test('rejects empty string', () => {
  const result = brandParamSchema.safeParse('');
  assert.equal(result.success, false);
});

test('optional brand defaults to gelatomiiix', () => {
  const schema = brandParamSchema.optional().default('gelatomiiix');
  const result = schema.safeParse(undefined);
  assert.ok(result.success);
  assert.equal(result.data, 'gelatomiiix');
});

test('BRAND_NAMES does NOT include yufeng', () => {
  assert.ok(!BRAND_NAMES.includes('yufeng'),
    'yufeng is deprecated and must not be in BRAND_NAMES');
});

test('BRAND_NAMES contains the 3 active brands', () => {
  assert.ok(BRAND_NAMES.includes('gelatomiiix'));
  assert.ok(BRAND_NAMES.includes('bonjur'));
  assert.ok(BRAND_NAMES.includes('tamkoko'));
  assert.equal(BRAND_NAMES.length, 3);
});
