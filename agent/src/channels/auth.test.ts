import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { verifyAgentToken } from './auth.ts'

const SECRET = 'test-secret-123'

// ensure env is set for the module under test
process.env.AGENT_JWT_SECRET = SECRET

test('verifyAgentToken accepts a valid token', () => {
  const token = jwt.sign({ sub: 'user-abc' }, SECRET, { expiresIn: '10m' })
  const out = verifyAgentToken(token)
  assert.equal(out.sub, 'user-abc')
  assert.ok(typeof out.exp === 'number')
})

test('verifyAgentToken rejects a forged token', () => {
  const token = jwt.sign({ sub: 'evil' }, 'wrong-secret', { expiresIn: '10m' })
  assert.throws(() => verifyAgentToken(token), /INVALID_TOKEN/)
})

test('verifyAgentToken rejects an expired token', () => {
  const token = jwt.sign({ sub: 'user-abc' }, SECRET, { expiresIn: '-1s' })
  assert.throws(() => verifyAgentToken(token), /EXPIRED_TOKEN/)
})

test('verifyAgentToken rejects empty string', () => {
  assert.throws(() => verifyAgentToken(''), /INVALID_TOKEN/)
})
