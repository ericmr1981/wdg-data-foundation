import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { verifyAgentToken } from './auth.ts'

// R7 (Phase 3) follow-up: auth.ts 走 jose(jwtVerify + createRemoteJWKSet)。
// 测试自建一对 RSA keypair,起本地 JWKS server,然后设 AGENT_JWKS_URL 指过去。

const PORT = 4317
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

async function signToken(claims: Record<string, any>, opts: { exp?: string; secret?: CryptoKey } = {}) {
  const key = opts.secret ?? privateKey
  const builder = new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setSubject(claims.sub ?? 'user')
  if (opts.exp) builder.setExpirationTime(opts.exp)
  return builder.sign(key)
}

test.before(async () => {
  await startJwksServer()
  process.env.AGENT_JWKS_URL = `http://127.0.0.1:${PORT}/.well-known/jwks.json`
})

test.after(async () => {
  await stopJwksServer()
  delete process.env.AGENT_JWKS_URL
})

test('verifyAgentToken accepts a valid RS256 token', async () => {
  const token = await signToken({ sub: 'user-abc' }, { exp: '10m' })
  const out = await verifyAgentToken(token)
  assert.equal(out.sub, 'user-abc')
  assert.ok(typeof out.exp === 'number')
})

test('verifyAgentToken rejects a token signed with the wrong key', async () => {
  const { privateKey: wrongPriv } = await generateKeyPair('RS256', { extractable: true })
  const token = await signToken({ sub: 'evil' }, { exp: '10m', secret: wrongPriv })
  await assert.rejects(() => verifyAgentToken(token), /INVALID_TOKEN/)
})

test('verifyAgentToken rejects an expired token', async () => {
  const token = await signToken({ sub: 'user-abc' }, { exp: '-1s' })
  await assert.rejects(() => verifyAgentToken(token), /EXPIRED_TOKEN/)
})

test('verifyAgentToken rejects empty string', async () => {
  await assert.rejects(() => verifyAgentToken(''), /INVALID_TOKEN/)
})
