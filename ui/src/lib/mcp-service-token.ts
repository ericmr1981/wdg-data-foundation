// ui/src/lib/mcp-service-token.ts
// MCP service-to-service auth for the create-store route.
// Client sends `X-Service-Token: <raw>` header (with `X-MCP-Session: internal`).
// We hash the raw token, constant-time-compare against the SHA-256 of
// WDG_SERVICE_TOKEN, and confirm the matching hash exists in
// ops.service_token (enabled = true). The DB lookup is the revocation check
// — env alone would let a rotated/leaked token keep working forever.

import crypto from 'node:crypto';
import pool from '@/lib/db';

export async function verifyMcpServiceToken(provided: string): Promise<boolean> {
  if (!provided) return false;
  const envToken = process.env.WDG_SERVICE_TOKEN;
  if (!envToken) return false;

  // 1. Constant-time compare of hashed tokens (defends against timing attacks).
  const providedHash = crypto.createHash('sha256').update(provided).digest('hex');
  const envHash = crypto.createHash('sha256').update(envToken).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(providedHash), Buffer.from(envHash))) {
    return false;
  }

  // 2. Confirm the token is still enabled in ops.service_token (not revoked).
  const { rowCount } = await pool.query(
    `SELECT 1 FROM ops.service_token WHERE token_hash = $1 AND enabled = true`,
    [envHash]
  );
  return (rowCount ?? 0) > 0;
}
