// agent/src/config/store.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  getAgentConfig, setAgentMd, setParam, setParams,
  setCredentialConfig, resetAgentConfig, DEFAULT_PARAMS,
  thinkingConfigFor, THINKING_BUDGET,
} from './store.ts'

test('DEFAULT_PARAMS has expected values', () => {
  assert.equal(DEFAULT_PARAMS.maxTokens, 4096)
  assert.equal(DEFAULT_PARAMS.temperature, 0.3)
  assert.equal(DEFAULT_PARAMS.maxToolChainDepth, 10)
  assert.equal(DEFAULT_PARAMS.tokenSoftLimit, 80_000)
  assert.equal(DEFAULT_PARAMS.tokenHardLimit, 200_000)
  assert.equal(DEFAULT_PARAMS.thinkingLevel, 'off')
})

test('THINKING_BUDGET maps correctly', () => {
  assert.equal(THINKING_BUDGET.low, 1024)
  assert.equal(THINKING_BUDGET.medium, 8192)
  assert.equal(THINKING_BUDGET.high, 16384)
})

test('thinkingConfigFor returns null for off', () => {
  assert.equal(thinkingConfigFor('off'), null)
})

test('thinkingConfigFor returns config for medium', () => {
  const c = thinkingConfigFor('medium')
  assert.deepEqual(c, { type: 'enabled', budget_tokens: 8192 })
})

test('defaultConfig initializes with DEFAULT_PARAMS', () => {
  resetAgentConfig()
  const cfg = getAgentConfig()
  assert.equal(cfg.model, 'claude-opus-4-8')
  // baseURL/apiKey 接受 env 变量 (CI 不污染; 干净 env 下是 null)
  assert.ok(cfg.baseURL === null || typeof cfg.baseURL === 'string')
  assert.ok(cfg.apiKey === null || typeof cfg.apiKey === 'string')
  assert.equal(cfg.params.temperature, 0.3)
})

test('setAgentMd updates content', () => {
  setAgentMd('# new content')
  assert.equal(getAgentConfig().agentMd, '# new content')
  resetAgentConfig()
})

test('setParam updates single param', () => {
  setParam('temperature', 0.7)
  assert.equal(getAgentConfig().params.temperature, 0.7)
  resetAgentConfig()
})

test('setParams updates multiple', () => {
  setParams({ temperature: 0.5, maxTokens: 8192 })
  const cfg = getAgentConfig()
  assert.equal(cfg.params.temperature, 0.5)
  assert.equal(cfg.params.maxTokens, 8192)
  resetAgentConfig()
})

test('setCredentialConfig updates baseURL/apiKey/model', () => {
  setCredentialConfig('https://api.test', 'sk-test', 'claude-sonnet-4-6')
  const cfg = getAgentConfig()
  assert.equal(cfg.baseURL, 'https://api.test')
  assert.equal(cfg.apiKey, 'sk-test')
  assert.equal(cfg.model, 'claude-sonnet-4-6')
  resetAgentConfig()
})
