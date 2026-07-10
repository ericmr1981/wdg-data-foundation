// R7 (Phase 3): RS256 + JWKS verification via `jose`.
// - HS256 + AGENT_JWT_SECRET 完全删除(对称 secret 不再走前端)
// - 公开 JWKS URL 由 env AGENT_JWKS_URL 提供,典型: Next.js portal
//   `https://<ui>/api/auth/jwks.json`
// - 失败原因: 'EXPIRED_TOKEN' / 'INVALID_TOKEN' (与下游 caller 兼容)

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'

export interface AgentClaims {
  sub: string
  exp: number
}

function jwks() {
  const url = process.env.AGENT_JWKS_URL
  if (!url) {
    throw new Error('INVALID_TOKEN: AGENT_JWKS_URL not configured')
  }
  return createRemoteJWKSet(new URL(url))
}

export async function verifyAgentToken(token: string): Promise<AgentClaims> {
  if (!token) {
    throw new Error('INVALID_TOKEN')
  }
  try {
    const { payload } = await jwtVerify(token, jwks(), { algorithms: ['RS256'] })
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('INVALID_TOKEN')
    }
    return claimsFromPayload(payload)
  } catch (e) {
    // jose 把过期单独立码 — 用 error.code 而不是 message(更稳)
    const code = (e as { code?: string }).code
    if (code === 'ERR_JWT_EXPIRED') {
      throw new Error('EXPIRED_TOKEN')
    }
    throw new Error('INVALID_TOKEN')
  }
}

function claimsFromPayload(payload: JWTPayload): AgentClaims {
  const exp = typeof payload.exp === 'number' ? payload.exp : 0
  return { sub: payload.sub as string, exp }
}
