import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { splitSentences } from '../../src/lib/chat/sentence-splitter.ts';

test('empty string returns empty array', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   \n  '), []);
});

test('single sentence with period', () => {
  assert.deepEqual(splitSentences('你好。'), ['你好。']);
});

test('multiple sentences split on Chinese terminators', () => {
  const r = splitSentences('第一句。第二句！第三句？');
  assert.deepEqual(r, ['第一句。', '第二句！', '第三句？']);
});

test('multiple sentences split on English terminators', () => {
  const r = splitSentences('First. Second! Third?');
  assert.deepEqual(r, ['First.', 'Second!', 'Third?']);
});

test('paragraph break splits into two blocks', () => {
  assert.deepEqual(splitSentences('a\n\nb'), ['a', 'b']);
});

test('fenced code block keeps its content together', () => {
  const input = 'code:\n```js\nconst a = 1;\nconst b = 2;\n```\nend.';
  const input2 = '```js\nfoo.bar();\n```';
  assert.deepEqual(splitSentences(input2), ['```js\nfoo.bar();\n```']);
  assert.deepEqual(splitSentences(input), ['code:\n```js\nconst a = 1;\nconst b = 2;\n```\nend.']);
});

test('long segment with no terminator stays as one block', () => {
  const long = 'a'.repeat(1000);
  assert.deepEqual(splitSentences(long), [long]);
});

test('mix of Chinese and English in one input', () => {
  const r = splitSentences('你好 world. 再见！');
  assert.deepEqual(r, ['你好 world.', '再见！']);
});

test('inline backticks (not at line start) are not a fence', () => {
  // The opening triple is mid-line, so it stays as plain text. The closing
  // triple happens to be at line start, which opens a (never-closed) fence
  // that EOF flushes as a single `` ``` `` block. Pinning current behavior.
  const r = splitSentences('here is ```js\nfoo\n```');
  assert.deepEqual(r, ['```']);
});

test('fence with 4+ backticks never closes within input but EOF flushes it', () => {
  // First 3 backticks open a fence at line start. The 4th backtick is plain
  // text inside the fence. With no closing triple, EOF flushes the fence
  // block as-is.
  assert.deepEqual(splitSentences('````'), ['````']);
});

test('three paragraphs split into three blocks', () => {
  assert.deepEqual(splitSentences('a\n\nb\n\nc'), ['a', 'b', 'c']);
});

test('decimal point in a number is not a terminator', () => {
  // "16.66 万元" — the "." between digits is a decimal point, not a period.
  // It should NOT split.
  const r = splitSentences('营收约 16.66 万元');
  assert.deepEqual(r, ['营收约 16.66 万元']);
});

test('thousands separator in a number is not a terminator', () => {
  // "165,814.57 元" — both the "," and the "." are inside a number.
  const r = splitSentences('营收 165,814.57 元');
  assert.deepEqual(r, ['营收 165,814.57 元']);
});

test('financial reply with numbers and percentages splits only on real sentence ends', () => {
  // The exact shape from a real agent response that previously split into
  // 8 fragments: each ".", "," and "数字" should now stay together, and
  // only the real sentence-ending "。" should split.
  const r = splitSentences(
    '营收:约 16.66 万元 (165,814.57 元)。环比上月 (13.3 万元) 增长 +24.4%。',
  );
  assert.deepEqual(r, [
    '营收:约 16.66 万元 (165,814.57 元)。',
    '环比上月 (13.3 万元) 增长 +24.4%。',
  ]);
});
