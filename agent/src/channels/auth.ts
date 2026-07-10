// 路 4 (2026-07-10): 启动时预取 JWKS → 同步 crypto.verify
// 根因: Node + ws 8 在 ws.on('message') 回调中调用 jose 的
// jwtVerify + createRemoteJWKSet 会导致 undici 的 fetch 阻塞微任务队列,
// Promise.resolve().then() 链不执行,auth 永远 hang。
//
// 解法: 启动时 (server.ts 的 main) 主动调 initAuth() fetch JWKS,
// 转换为 crypto.KeyObject (同步)。verifyAgentToken 只用 crypto.verify()
// 验签,完全不碰 jose/jwtVerify/createRemoteJWKSet,也不碰 undici fetch。
//
// 降级: 如果 initAuth() 未调用/失败,verifyAgentToken 抛 INVALID_TOKEN。
// Portal 部署后 env AGENT_JWKS_URL 指向 portal 的 JWKS 端点。

import crypto from 'node:crypto'
import type { JWTPayload } from 'jose'

export interface AgentClaims {
  sub: string
  exp: number
}

// 单个 RSA 公钥(预取后赋值),支持 RS256。
let _pubKey: crypto.KeyObject | null = null
let _initError: string | null = null

/**
 * 启动时由 server.ts 的 main() 调用。
 * 强制 fetch JWKS → 提取 RSA 公钥 → 转换为 crypto.KeyObject。
 * 如果 AGENT_JWKS_URL 未配置或 fetch 失败,记 _initError 但不抛(允许降级到 INVALID_TOKEN)。
 */
export async function initAuth(): Promise<void> {
  const url = process.env.AGENT_JWKS_URL
  if (!url) {
    _initError = 'AGENT_JWKS_URL not configured'
    console.warn('[auth]', _initError)
    return
  }
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const jwks: any = await res.json()
    const key = jwks?.keys?.[0]
    if (!key || key.kty !== 'RSA') throw new Error('no RSA key in JWKS')

    _pubKey = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: key.n,
        e: key.e,
      },
      format: 'jwk',
    })
    console.log('[auth] JWKS loaded, kid=' + (key.kid ?? '?') + ' alg=' + (key.alg ?? 'RS256'))
  } catch (e) {
    _initError = (e as Error).message
    console.error('[auth] initAuth failed:', _initError)
  }
}

/**
 * 同步 RS256 验签(不碰 jose/jwtVerify/fetch)。
 * 如果 _pubKey 未就位(initAuth 还没跑完或失败),抛 INVALID_TOKEN。
 */
export function verifyAgentToken(token: string): AgentClaims {
  if (!token) throw new Error('INVALID_TOKEN')

  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('INVALID_TOKEN')

  // 解码 header + payload(仅用于提取字段)
  let payload: any
  const p1 = parts[1]
  if (!p1) throw new Error('INVALID_TOKEN')
  try {
    payload = JSON.parse(Buffer.from(p1, 'base64url').toString())
  } catch {
    throw new Error('INVALID_TOKEN')
  }

  // 过期检查
  if (payload.exp && Date.now() > payload.exp * 1000) {
    throw new Error('EXPIRED_TOKEN')
  }

  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('INVALID_TOKEN')
  }

  if (!_pubKey) {
    throw new Error('INVALID_TOKEN: ' + (_initError ?? 'JWKS not loaded'))
  }

  const p0 = parts[0]
  const p2 = parts[2]
  if (!p0 || !p2) throw new Error('INVALID_TOKEN')

  const data = Buffer.from(p0 + '.' + p1)
  const sig = Buffer.from(p2, 'base64url')

  const ok = crypto.verify('sha256', data, _pubKey, sig)
  if (!ok) throw new Error('INVALID_TOKEN')

  return { sub: payload.sub, exp: payload.exp ?? 0 }
}
