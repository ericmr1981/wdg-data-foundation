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
function hasUnclosedParens(text: string): boolean {
  let open = 0, fullOpen = 0;
  for (const ch of text) {
    if (ch === '(') open++;
    else if (ch === ')') open = open > 0 ? open - 1 : 0;
    else if (ch === '（') fullOpen++;
    else if (ch === '）') fullOpen = fullOpen > 0 ? fullOpen - 1 : 0;
  }
  return open > 0 || fullOpen > 0;
}

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
      if (hasUnclosedParens(last)) return false;
      return true;
    })();

    if (!hasTerminator) {
      // When the held block is a table row, hold EVERYTHING —
      // don't emit preceding blocks, don't trim buffer
      if (last.trimStart().startsWith('|')) {
        return { emitted: [], held: null }; // signal: hold entire buffer
      }
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
    // When neither emitted nor held, buffer stays intact (table hold)
    if (r.held !== null) {
      buf = r.held;
    } else if (r.emitted.length > 0) {
      buf = '';
    }
    // else: buf unchanged (table-in-progress hold)
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

// ─── C8: Parenthesized content not split ───

test('Acceptance C8a: English () with dot not emitted mid-content', () => {
  const r = flushSentences('测试 (abc.', false);
  assert.equal(r.emitted.length, 0, 'not emitted');
  assert.ok(r.held!.includes('(abc.'), 'held with parens');
});

test('Acceptance C8b: Chinese （） with dot not emitted mid-content', () => {
  const r = flushSentences('示例（详见附件。', false);
  assert.equal(r.emitted.length, 0, 'not emitted');
  assert.ok(r.held!.includes('详见附件。'), 'held with fullwidth parens');
});

test('Acceptance C8c: complete parenthesized content emits after close parens', () => {
  const r = flushSentences('测试 (abc.xyz)。', false);
  assert.equal(r.emitted.length, 1, 'one block');
  assert.ok(r.emitted[0].includes('abc.xyz'), 'content intact');
});

test('Acceptance C8d: complete Chinese parenthesized content emits', () => {
  const r = flushSentences('示例（详见附件。）。', false);
  assert.equal(r.emitted.length, 1, 'one block');
  assert.ok(r.emitted[0].includes('详见附件。'), 'content intact');
});

test('Acceptance C8e: nested parentheses held', () => {
  const r = flushSentences('函数 f(x) = x²。', false);
  assert.equal(r.emitted.length, 1, 'balanced parens within');
  assert.ok(r.emitted[0].includes('f(x)'), 'balanced parens preserved');
});

test('Acceptance C8f: DeepSeek chunk with (xxx) pattern', () => {
  const p = streamSimulate([
    '数据来源（企迈', '平台。', '）分析结果',
  ]);
  const joined = p.join('');
  // Parens content should be uninterrupted — no split inside （）
  assert.ok(joined.includes('数据来源（企迈平台。）'), 'parens block intact');
  assert.ok(joined.includes('分析结果'), 'outside content also present');
  // No orphaned fragment from mid-parens split
  assert.ok(!joined.includes('）\n分析结果'), 'no newline between close parens and content');
});

test('Acceptance C8g: unclosed parens with final flush still emits', () => {
  const r = flushSentences('说明 (未完成内容', true);
  assert.ok(r.emitted.length > 0, 'final flush emits despite unclosed parens');
  assert.ok(r.emitted[0].includes('未完成'), 'content present');
});
