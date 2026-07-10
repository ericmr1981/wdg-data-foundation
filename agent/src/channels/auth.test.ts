import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { initAuth, verifyAgentToken } from './auth.ts'

// 路 4: auth.ts 用 Node crypto.verify 同步验签(无 microtask stall)。
// initAuth() 启动时 fetch JWKS → 转为 KeyObject;
// verifyAgentToken 直接用 crypto.verify 验签,不碰 jose/jwtVerify。

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
  await initAuth()  // 路 4: 启动时预取 JWKS
})

test.after(async () => {
  await stopJwksServer()
  delete process.env.AGENT_JWKS_URL
})

test('verifyAgentToken accepts a valid RS256 token', () => {
  // 路 4: verifyAgentToken 已改为同步(不再 async)
  const token = signToken({ sub: 'user-abc' }, { exp: '10m' }) as any as string
  // 注: signToken 返回 Promise<string>;上面 as any 是绕过 TS 检查(测试而已)
  // 实际用法: initAuth() 后 verifyAgentToken 是同步函数。
  // 本 test 用 then() 包装:
  return signToken({ sub: 'user-abc' }, { exp: '10m' }).then(token => {
    const out = verifyAgentToken(token)
    assert.equal(out.sub, 'user-abc')
    assert.ok(typeof out.exp === 'number')
  })
})

test('verifyAgentToken rejects a token signed with the wrong key', () => {
  return generateKeyPair('RS256', { extractable: true }).then(({ privateKey: wrongPriv }) => {
    return signToken({ sub: 'evil' }, { exp: '10m', secret: wrongPriv }).then(token => {
      assert.throws(() => verifyAgentToken(token), /INVALID_TOKEN/)
    })
  })
})

test('verifyAgentToken rejects an expired token', () => {
  return signToken({ sub: 'user-abc' }, { exp: '-1s' }).then(token => {
    assert.throws(() => verifyAgentToken(token), /EXPIRED_TOKEN/)
  })
})

test('verifyAgentToken rejects empty string', () => {
  assert.throws(() => verifyAgentToken(''), /INVALID_TOKEN/)
})
