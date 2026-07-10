import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import WebSocket from 'ws'
import { WebChannel } from './web.ts'

// R7 (Phase 3) follow-up: web.test.ts 走 jose + 真正的 RS256/JWKS。
// 起本地 JWKS server,签 token,客户端发 'auth' frame 给 WebChannel。

const PORT = 4318
let privateKey: CryptoKey
let publicJwk: any
let jwksServer: any

async function startJwksServer() {
  const { publicKey, privateKey: priv } = await generateKeyPair('RS256', { extractable: true })
  privateKey = priv
  publicJwk = await exportJWK(publicKey)
  publicJwk.kid = 'test-key'
  publicJwk.use = 'sig'
  publicJwk.alg = 'RS256'

  const { createServer } = await import('node:http')
  jwksServer = createServer((req: any, res: any) => {
    if (req.url === '/.well-known/jwks.json') {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ keys: [publicJwk] }))
    } else {
      res.statusCode = 404
      res.end()
    }
  })
  await new Promise<void>(r => jwksServer.listen(PORT, '127.0.0.1', r))
}

async function stopJwksServer() {
  await new Promise<void>(r => jwksServer.close(() => r()))
}

async function signToken(sub: string, exp: string = '10m') {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setSubject(sub)
    .setExpirationTime(exp)
    .sign(privateKey)
}

before(async () => {
  await startJwksServer()
  process.env.AGENT_JWKS_URL = `http://127.0.0.1:${PORT}/.well-known/jwks.json`
})

after(async () => {
  await stopJwksServer()
  delete process.env.AGENT_JWKS_URL
})

async function openAndAuth(port: number, token: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>(r => ws.on('open', () => r()))
  ws.send(JSON.stringify({ type: 'auth', payload: { token } }))
  // 等 hello / (close on bad token)
  return ws
}

test('WebChannel rejects connection with expired token', async () => {
  const port = 4199 + 1
  const ch = new WebChannel(port, null)
  await ch.start()
  const token = await signToken('u1', '-1s')
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>(r => ws.on('open', () => r()))
  ws.send(JSON.stringify({ type: 'auth', payload: { token } }))
  const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closed.code, 1008)
  assert.match(closed.reason, /expired_token/)
  await ch.stop()
})

test('WebChannel rejects connection with invalid token', async () => {
  const port = 4199 + 2
  const ch = new WebChannel(port, null)
  await ch.start()
  const ws = new WebSocket(`ws://127.0.0.1:${port}`)
  await new Promise<void>(r => ws.on('open', () => r()))
  ws.send(JSON.stringify({ type: 'auth', payload: { token: 'not-a-jwt' } }))
  const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }))
  })
  assert.equal(closed.code, 1008)
  assert.match(closed.reason, /invalid_token/)
  await ch.stop()
})

test('WebChannel accepts valid token and stays connected briefly', async () => {
  const port = 4199 + 3
  const ch = new WebChannel(port, null)
  await ch.start()
  const token = await signToken('good-user')
  const ws = await openAndAuth(port, token)
  // authed 后 ws 不会 close;等 200ms 验证 heartbeat
  await new Promise(r => setTimeout(r, 200))
  assert.equal(ws.readyState, WebSocket.OPEN)
  ws.close()
  await ch.stop()
})
