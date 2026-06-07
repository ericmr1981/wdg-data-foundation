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
