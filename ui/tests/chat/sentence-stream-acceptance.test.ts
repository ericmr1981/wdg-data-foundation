// ui/tests/chat/sentence-stream-acceptance.test.ts
// Acceptance tests for streaming sentence splitting.
// Tests the exact flushSentences logic from route.ts against a comprehensive
// set of edge cases: decimal numbers, percentages, ordered lists, abbreviations,
// DeepSeek chunking patterns, etc.
//
// Run: cd ui && node --experimental-strip-types tests/chat/sentence-stream-acceptance.test.ts

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { splitSentences } from '../../src/lib/chat/sentence-splitter.ts';

// Exact replica of route.ts flushSentences
function flushSentences(buffer: string, final = false): { emitted: string[]; held: string | null } {
  const SENTENCE_FLUSH_THRESHOLD = 800;
  const result: { emitted: string[]; held: string | null } = { emitted: [], held: null };
  if (!buffer) return result;

  if (!final && buffer.length < SENTENCE_FLUSH_THRESHOLD) {
    const blocks = splitSentences(buffer);
    if (blocks.length === 0) return result;
    const last = blocks[blocks.length - 1];

    const hasTerminator = (() => {
      const m = /[。！？.!?]\s*$/.exec(last);
      if (!m) return false;
      const dotIdx = last.length - m[0].length;
      if (last[dotIdx] === '.' && dotIdx > 0) {
        const prev = last[dotIdx - 1];
        if (prev >= '0' && prev <= '9') return false;
      }
      return true;
    })();

    if (!hasTerminator) {
      result.emitted = blocks.slice(0, -1);
      result.held = last;
      return result;
    }
    result.emitted = blocks;
    return result;
  }

  // Final flush — emit everything
  result.emitted = splitSentences(buffer);
  return result;
}

// Simulate stepwise token arrival (like LLM streaming)
function streamSimulate(tokens: string[]): string[] {
  let buf = '', emitted: string[] = [];
  for (const token of tokens) {
    buf += token;
    const r = flushSentences(buf, false);
    for (const e of r.emitted) emitted.push(e);
    buf = r.held !== null ? r.held : (r.emitted.length > 0 ? '' : buf);
  }
  const r = flushSentences(buf, true);
  for (const e of r.emitted) emitted.push(e);
  return emitted;
}

// ─── C1: Numbers with decimals NEVER split ───

test('Acceptance C1a: mid-decimal should not emit', () => {
  const r = flushSentences('营收 46,602.', false);
  assert.equal(r.emitted.length, 0, 'no emit at mid-decimal');
  assert.ok(r.held!.includes('46,602.'), 'mid-decimal held in buffer');
});

test('Acceptance C1b: complete decimal sentence emits as one block', () => {
  const r = flushSentences('营收 46,602.26 元。', false);
  assert.equal(r.emitted.length, 1, 'one block');
  assert.ok(r.emitted[0].includes('46,602.26'), 'decimal number intact');
});

test('Acceptance C1c: percentage preserved', () => {
  const r = flushSentences('同比增长 23.45%。', false);
  assert.equal(r.emitted.length, 1, 'one block');
  assert.ok(r.emitted[0].includes('23.45%'), 'percentage intact');
});

// ─── C2: Chinese 。 always terminates ───

test('Acceptance C2a: Chinese 。 splits regardless of preceding digits', () => {
  const r = flushSentences('报告显示 46.2%。详情见附件。', false);
  assert.ok(r.emitted.length >= 2, 'should emit both parts');
  assert.ok(r.emitted[0].includes('46.2%'), 'first part includes percentage');
  assert.ok(r.emitted[1].includes('详情'), 'second part is clean');
});

test('Acceptance C2b: Chinese 。 with English content', () => {
  const r = flushSentences('版本 v1.0。测试通过。', false);
  assert.equal(r.emitted.length, 2, 'two sentences');
});

// ─── C3: Ordered lists not broken ───

test('Acceptance C3a: ordered list prefix held during streaming', () => {
  const r = flushSentences('2. 点击', false);
  assert.equal(r.emitted.length, 0, 'no emission mid-list');
});

test('Acceptance C3b: ordered list complete emits intact', () => {
  const r = flushSentences('2. 点击上传按钮。', false);
  assert.equal(r.emitted.length, 1, 'one block');
  assert.ok(r.emitted[0].startsWith('2.'), 'list prefix preserved');
});

// ─── C4: DeepSeek-style chunking patterns ───

test('Acceptance C4a: DeepSeek chunk with decimal', () => {
  const p = streamSimulate(['营收 ', '46,', '602.', '26 元', '。']);
  const joined = p.join('');
  assert.ok(joined.includes('46,602.26'), 'decimal number intact across chunks');
});

test('Acceptance C4b: DeepSeek chunk with percentage', () => {
  const p = streamSimulate(['同比', '增长 ', '23.', '45%', '。']);
  const joined = p.join('');
  assert.ok(joined.includes('23.45%'), 'percentage intact across chunks');
});

test('Acceptance C4c: DeepSeek financial data chunking', () => {
  const p = streamSimulate([
    '本期总营收 165,814.57 元',
    '，主营业务收入 132,456.89 元',
    '。成本支出 45,678.12 元。',
  ]);
  const joined = p.join('');
  assert.ok(joined.includes('165,814.57'), 'big number intact');
  assert.ok(joined.includes('132,456.89'), 'second number intact');
  assert.ok(joined.includes('45,678.12'), 'third number intact');
});

// ─── C5: No premature emission ───

test('Acceptance C5a: incomplete thought not emitted', () => {
  const r = flushSentences('以下是对', false);
  assert.equal(r.emitted.length, 0, 'incomplete should not emit');
});

test('Acceptance C5b: sentence-ending number+dot held', () => {
  const r = flushSentences('The total is $46,602.', false);
  assert.equal(r.emitted.length, 0, 'not emitted');
  assert.ok(r.held!.includes('46,602'), 'held');
});

test('Acceptance C5c: English sentence with number ending is held', () => {
  const r = flushSentences('Revenue is 50000.', false);
  assert.equal(r.emitted.length, 0, 'not emitted');
  assert.ok(r.held!.includes('50000'), 'held');
});

// ─── C6: Final flush always empties buffer ───

test('Acceptance C6a: final flush emits everything', () => {
  const r = flushSentences('营收 46,602.26 元', true);
  assert.equal(r.emitted.length, 1, 'one block on final');
  assert.ok(r.emitted[0].includes('46,602.26'), 'number intact');
});

test('Acceptance C6b: multiple sentences on final flush', () => {
  const r = flushSentences('营收 50,000 元。成本 30,000 元。', true);
  assert.equal(r.emitted.length, 2, 'two blocks');
});

// ─── C7: splitSentences itself should never split on . ───

test('Acceptance C7a: splitSentences does not split on decimal .', () => {
  const p = splitSentences('总营收 165,814.57 元');
  assert.equal(p.length, 1, 'number not split');
  assert.ok(p[0].includes('165,814.57'), 'content preserved');
});

test('Acceptance C7b: splitSentences keeps ordered list prefix', () => {
  const p = splitSentences('2. 点击上传');
  assert.equal(p.length, 1, 'list not split');
  assert.ok(p[0].startsWith('2.'), 'prefix preserved');
});
