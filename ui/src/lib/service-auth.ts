// ui/src/lib/service-auth.ts
// Service-to-service auth: client sends `X-Service-Token: <raw>` header.
// We SHA-256 the raw token and look it up in ops.service_token.
// We do NOT support user-cookie auth here — that's a separate concern.

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import pool from '@/lib/db';

export interface ServiceAuth {
  id: number;
  name: string;
}

export async function requireServiceToken(req: NextRequest, name: string): Promise<ServiceAuth | null> {
  const raw = req.headers.get('x-service-token');
  if (!raw) return null;
  const hash = createHash('sha256').update(raw).digest('hex');
  const { rows } = await pool.query(
    `SELECT id, name FROM ops.service_token
     WHERE token_hash = $1 AND enabled = true AND name = $2`,
    [hash, name]
  );
  if (rows.length === 0) return null;
  // Fire-and-forget: update last_used_at (do not block request)
  pool.query(
    `UPDATE ops.service_token SET last_used_at = now() WHERE id = $1`,
    [rows[0].id]
  ).catch(() => {/* ignore */});
  return { id: rows[0].id, name: rows[0].name };
}
