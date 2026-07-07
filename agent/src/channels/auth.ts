import jwt from 'jsonwebtoken'

export interface AgentClaims {
  sub: string
  exp: number
}

export function verifyAgentToken(token: string): AgentClaims {
  if (!token) {
    throw new Error('INVALID_TOKEN')
  }
  const secret = process.env.AGENT_JWT_SECRET
  if (!secret) {
    throw new Error('INVALID_TOKEN: AGENT_JWT_SECRET not configured')
  }
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as AgentClaims
    if (!payload.sub || typeof payload.sub !== 'string') {
      throw new Error('INVALID_TOKEN')
    }
    return { sub: payload.sub, exp: payload.exp }
  } catch (e) {
    const msg = (e as Error).message
    if (msg.includes('jwt expired')) {
      throw new Error('EXPIRED_TOKEN')
    }
    throw new Error('INVALID_TOKEN')
  }
}
