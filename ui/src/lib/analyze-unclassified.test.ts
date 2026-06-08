// ui/src/lib/analyze-unclassified.test.ts
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore
import { parseModelResponse, buildUserPrompt } from './analyze-unclassified.pure.ts';

test('parseModelResponse strips json fences', () => {
  const text = '```json\n[{"bank_txn_id": 1, "type": "type1", "llm_proposal": null, "reasoning": null}]\n```';
  const out = parseModelResponse(text);
  assert.equal(out.length, 1);
  assert.equal(out[0].bank_txn_id, 1);
});

test('parseModelResponse handles raw json', () => {
  const text = '[{"bank_txn_id": 2, "type": "type2", "llm_proposal": null, "reasoning": "x"}]';
  const out = parseModelResponse(text);
  assert.equal(out[0].bank_txn_id, 2);
  assert.equal(out[0].type, 'type2');
});

test('parseModelResponse throws on non-array', () => {
  assert.throws(() => parseModelResponse('{"not": "array"}'), /not a JSON array/);
});

test('buildUserPrompt embeds txn JSON', () => {
  const prompt = buildUserPrompt('tamkoko', [
    { bank_txn_id: 1, source_file_id: 1, txn_time: '2026-06-01', summary: '工资', memo: null, purpose: null, counterparty_name: '员工', in_amt: 0, out_amt: 100 },
  ]);
  assert.ok(prompt.includes('tamkoko'));
  assert.ok(prompt.includes('"bank_txn_id": 1'));
  assert.ok(prompt.includes('员工'));
});
