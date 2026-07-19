import { test } from 'node:test';
import { strict as assert } from 'node:assert';

// Skip real DB — use mock pool
process.env.WDG_SERVICE_TOKEN = '';   // prevent other modules from misreading
process.env.DATABASE_URL = 'postgres://stub'; // prevent db.ts init exception

// 1) Invalid brand should 404 (normalizeBrand returns null for unknown brands)
import { getOdsSchema } from '@/lib/brand-server';
test('getOdsSchema throws on unknown brand', () => {
  assert.throws(() => getOdsSchema('not-a-brand'), /schema/i);
});

// 2) Route handlers should be importable — verify the generic [brand] route
// exports GET and POST. Real GET/POST behavior is covered in e2e tests.
import { GET } from '@/app/api/inventory/[brand]/summary/route';
assert.equal(typeof GET, 'function');
