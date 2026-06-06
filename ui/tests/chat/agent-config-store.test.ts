// ui/tests/chat/agent-config-store.test.ts
// Test runner: `node --test` (Node 22+) with --experimental-strip-types.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
// @ts-ignore -- allow .ts extension import (TS5097) for node --experimental-strip-types
import { getAgentConfig, setAgentMd, setParam, setParams, setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS } from '../../src/lib/chat/agent-config-store.ts';

test('initial state has default params and loaded agent.md', () => {
  resetAgentConfig();
  const c = getAgentConfig();
  assert.deepEqual(c.params, DEFAULT_PARAMS);
  assert.ok(c.agentMd.length > 0);
  assert.match(c.agentMd, /项目级 Agent 指令/);
});

test('setAgentMd updates content', () => {
  resetAgentConfig();
  setAgentMd('# Custom content');
  assert.equal(getAgentConfig().agentMd, '# Custom content');
});

test('setParam updates a single field', () => {
  resetAgentConfig();
  setParam('maxTokens', 1024);
  assert.equal(getAgentConfig().params.maxTokens, 1024);
  assert.equal(getAgentConfig().params.temperature, 0.3); // other fields unchanged
});

test('setParams updates multiple fields', () => {
  resetAgentConfig();
  setParams({ temperature: 0.7, maxToolChainDepth: 15 });
  const p = getAgentConfig().params;
  assert.equal(p.temperature, 0.7);
  assert.equal(p.maxToolChainDepth, 15);
  assert.equal(p.maxTokens, 4096); // unchanged
});

test('resetAgentConfig returns to defaults', () => {
  setAgentMd('# temporary');
  setParam('maxTokens', 999);
  resetAgentConfig();
  const c = getAgentConfig();
  assert.equal(c.params.maxTokens, 4096);
  assert.match(c.agentMd, /项目级 Agent 指令/);
});

test('initial state: baseURL/apiKey null, model default', () => {
  resetAgentConfig();
  const c = getAgentConfig();
  assert.equal(c.baseURL, null);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, 'claude-opus-4-8');
});

test('setCredentialConfig updates baseURL/apiKey/model', () => {
  resetAgentConfig();
  setCredentialConfig('https://proxy.example.com', 'sk-test-1234', 'claude-sonnet-4-6');
  const c = getAgentConfig();
  assert.equal(c.baseURL, 'https://proxy.example.com');
  assert.equal(c.apiKey, 'sk-test-1234');
  assert.equal(c.model, 'claude-sonnet-4-6');
});

test('setCredentialConfig with null baseURL/key is allowed', () => {
  setCredentialConfig('https://x', 'k', 'm');
  setCredentialConfig(null, null, 'claude-opus-4-8');
  const c = getAgentConfig();
  assert.equal(c.baseURL, null);
  assert.equal(c.apiKey, null);
  assert.equal(c.model, 'claude-opus-4-8');
});
