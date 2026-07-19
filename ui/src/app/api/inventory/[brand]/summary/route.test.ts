import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { getOdsSchema } from '@/lib/brand-server';

test('getOdsSchema throws on unknown brand', () => {
  assert.throws(() => getOdsSchema('not-a-brand'), /schema/i);
});

test('getOdsSchema resolves tamkoko', () => {
  assert.equal(getOdsSchema('tamkoko'), 'brand_tamkoko_ods');
});

test('getOdsSchema resolves gelatomiiix', () => {
  assert.equal(getOdsSchema('gelatomiiix'), 'brand_gelatomiiix_ods');
});
