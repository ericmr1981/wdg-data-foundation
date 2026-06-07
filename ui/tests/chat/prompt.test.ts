// ui/tests/chat/prompt.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.
// vitest is not installed; behavior is equivalent to the plan's vitest specs.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { buildSystemPrompt } from '../../src/lib/chat/prompt.ts';
import type { PageCtx } from '../../src/lib/chat/prompt.ts';

const baseTools = [
  { name: 'get_brand_stores',           description: 'desc-a', input_schema: {} },
  { name: 'query_store_report_snapshot', description: 'desc-b', input_schema: {} },
];

test('buildSystemPrompt includes the 4 context fields when set', () => {
  const ctx: PageCtx = { brand: 'bonjur', store: 'wz_ra', period: '2026-04', page: 'financial' };
  const out = buildSystemPrompt(ctx, baseTools);
  assert.match(out, /brand=bonjur/);
  assert.match(out, /store=wz_ra/);
  assert.match(out, /period=2026-04/);
  assert.match(out, /page=financial/);
});

test('buildSystemPrompt marks unset context fields as <none>', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /brand=<none>/);
  assert.match(out, /store=<none>/);
});

test('buildSystemPrompt lists every tool name', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.ok(out.includes('get_brand_stores'));
  assert.ok(out.includes('query_store_report_snapshot'));
});

test('buildSystemPrompt includes the "use tools, do not make up numbers" rule', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /use tools/i);
  assert.match(out, /don't make up numbers/i);
});

test('buildSystemPrompt encodes the bank classification direction rule', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /in_amt > 0/);
  assert.match(out, /REV_BIZ/);
  assert.match(out, /EXP_/);
});

test('buildSystemPrompt warns against direct DB access and forbidden tools', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /never.*direct.*db/i);
  assert.match(out, /xintiandi/);
  assert.match(out, /export_rules/);
});

test('buildSystemPrompt mentions brand codes for tool parameter guidance', () => {
  const out = buildSystemPrompt({}, baseTools);
  // Verify the 3 brands are referenced so Claude knows the right brand_code
  assert.match(out, /gelatomiiix/);
  assert.match(out, /bonjur/);
  assert.match(out, /tamkoko/);
});

test('buildSystemPrompt injects today date in YYYY-MM-DD format', () => {
  const out = buildSystemPrompt({}, baseTools);
  // Today should be present and in YYYY-MM-DD format
  const today = new Date().toISOString().slice(0, 10);
  assert.match(out, new RegExp(`Today: ${today}`));
});

test('buildSystemPrompt warns that ctx.period is viewing context, not query period', () => {
  const out = buildSystemPrompt({ period: '2026-04' }, baseTools);
  assert.match(out, /NOT necessarily the period they want/i);
});

test('buildSystemPrompt compact mode drops brand code hints and operator redirect', () => {
  const ctx: PageCtx = { brand: 'bonjur', store: 'wz_ra' };
  const out = buildSystemPrompt(ctx, baseTools, { compact: true });
  // The compact prompt drops the long "Tool usage conventions" section,
  // which includes brand/store code hints and the operator-role redirect.
  assert.doesNotMatch(out, /For tamkoko, store codes are/i);
  assert.doesNotMatch(out, /store codes are hz_fuyang/i);
  assert.doesNotMatch(out, /权限不足/i);
  // It also raises the in-chain tool limit from 5 to 10.
  assert.match(out, /Don't call more than 10 tools/i);
  assert.doesNotMatch(out, /Don't call more than 5 tools/i);
});

test('buildSystemPrompt compact mode keeps the bank classification direction rule', () => {
  const out = buildSystemPrompt({}, baseTools, { compact: true });
  // Core rules must survive compaction.
  assert.match(out, /in_amt > 0/);
  assert.match(out, /REV_BIZ/);
  assert.match(out, /EXP_/);
  // Forbidden shortcuts (security-critical) are also kept.
  assert.match(out, /xintiandi/);
  assert.match(out, /export_rules/);
  // And the general "use tools, do not make up numbers" rule.
  assert.match(out, /use tools/i);
  assert.match(out, /don't make up numbers/i);
});

test('buildSystemPrompt includes customInstructions from agent.md', () => {
  const out = buildSystemPrompt({}, baseTools, { customInstructions: '# My custom rules' });
  assert.match(out, /Custom Instructions \(from agent\.md\)/);
  assert.match(out, /# My custom rules/);
});

test('buildSystemPrompt compact mode keeps customInstructions', () => {
  const out = buildSystemPrompt({}, baseTools, { compact: true, customInstructions: '# Always' });
  assert.match(out, /# Always/);
});

test('buildSystemPrompt without customInstructions omits the section', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.doesNotMatch(out, /Custom Instructions/);
});

test('buildSystemPrompt includes the financial rate rule (cash-basis, decimal, prefer overview)', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /cash-basis|cash basis|收付实现制/i);
  assert.match(out, /grossMarginRate/);
  assert.match(out, /netProfitRate/);
  assert.match(out, /query_financial_overview/);
  assert.match(out, /decimal|0\.42|0\.35/i);
});

test('buildSystemPrompt warns not to confuse vsPrevPeriod with current period', () => {
  const out = buildSystemPrompt({}, baseTools);
  assert.match(out, /vsPrevPeriod/);
  assert.match(out, /do not confuse|current period/i);
});

test('buildSystemPrompt compact mode keeps the financial rate rule', () => {
  const out = buildSystemPrompt({}, baseTools, { compact: true });
  // Core financial rule must survive compaction.
  assert.match(out, /query_financial_overview/);
  assert.match(out, /grossMarginRate/);
});

test('buildSystemPrompt distinguishes decimal *Rate fields from percent *_pct fields', () => {
  const out = buildSystemPrompt({}, baseTools);
  // The rule should mention both conventions so the model picks correctly.
  assert.match(out, /grossMarginRate|netProfitRate/);
  assert.match(out, /gross_profit_rate_pct|net_profit_rate_pct/);
});

test('buildSystemPrompt FINANCIAL_RATE_RULE excludes BONUS from net profit', () => {
  const out = buildSystemPrompt({}, baseTools);
  // The rule should explicitly mention BONUS / 分红 and that it is excluded from net profit.
  assert.match(out, /BONUS|分红/);
  assert.match(out, /net profit|净利润/i);
  // It should also clarify that OTHER EXP_OTHER items (TAX, REPAY, REFUND) ARE deducted.
  assert.match(out, /EXP_OTHER/);
  assert.match(out, /TAX|REPAY|REFUND/);
});
