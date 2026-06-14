import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ApiError, assertApiOk, assertApiSuccess } from '../../src/lib/api-error.ts';

test('ApiError stores status code and message', () => {
  const err = new ApiError(404, 'Brand not found');
  assert.equal(err.status, 404);
  assert.equal(err.message, 'API error 404: Brand not found');
});

test('assertApiOk throws ApiError for non-ok response', async () => {
  const res = new Response('not found', { status: 404 });
  try {
    await assertApiOk(res, 'test_op');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.equal((e as ApiError).status, 404);
    assert.ok((e as ApiError).message.includes('test_op'));
  }
});

test('assertApiOk returns undefined for ok response', async () => {
  const res = new Response('{}', { status: 200 });
  const result = await assertApiOk(res, 'test_op');
  assert.equal(result, undefined);
});

test('assertApiSuccess throws when json.success is falsy', async () => {
  const res = new Response(JSON.stringify({ success: false, error: 'bad input' }), { status: 200 });
  try {
    await assertApiSuccess(res, 'test_op');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.ok((e as ApiError).message.includes('bad input'));
  }
});

test('assertApiSuccess returns parsed json on success', async () => {
  const res = new Response(JSON.stringify({ success: true, data: { x: 1 } }), { status: 200 });
  const json = await assertApiSuccess(res, 'test_op');
  assert.equal(json.data.x, 1);
});

test('assertApiSuccess without success field returns parsed json (lenient)', async () => {
  const res = new Response(JSON.stringify({ data: { x: 1 } }), { status: 200 });
  const json = await assertApiSuccess(res, 'test_op');
  assert.equal(json.data.x, 1);
});
