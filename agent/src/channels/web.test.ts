import { test } from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import WebSocket from 'ws'
import { WebChannel } from './web.ts'

const SECRET = 'integration-secret'
process.env.AGENT_JWT_SECRET = SECRET
const BASE_PORT = 4199

test('WebChannel rejects connection without token', async () => {
  const port = BASE_PORT + 1
  const ch = new WebChannel(port, null)
  await ch.start()
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  const closed = await new Promise<{ code: number, reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closed.code, 1008)
  assert.match(closed.reason, /missing_token/)
  await ch.stop()
})

test('WebChannel rejects expired token', async () => {
  const port = BASE_PORT + 2
  const ch = new WebChannel(port, null)
  await ch.start()
  const token = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: '-1s' })
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`)
  const closed = await new Promise<{ code: number, reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closed.code, 1008)
  assert.match(closed.reason, /expired_token/)
  await ch.stop()
})

test('WebChannel rejects forged token', async () => {
  const port = BASE_PORT + 3
  const ch = new WebChannel(port, null)
  await ch.start()
  const token = jwt.sign({ sub: 'evil' }, 'wrong-secret', { expiresIn: '10m' })
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`)
  const closed = await new Promise<{ code: number, reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closed.code, 1008)
  assert.match(closed.reason, /invalid_token/)
  await ch.stop()
})

test('WebChannel accepts valid token and stays connected briefly', async () => {
  const port = BASE_PORT + 4
  const ch = new WebChannel(port, null)
  await ch.start()
  const token = jwt.sign({ sub: 'good-user' }, SECRET, { expiresIn: '10m' })
  const ws = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`)
  const opened = await new Promise<boolean>((resolve) => {
    ws.on('open', () => resolve(true))
    ws.on('close', () => resolve(false))
  })
  assert.equal(opened, true)
  ws.close()
  await ch.stop()
})
