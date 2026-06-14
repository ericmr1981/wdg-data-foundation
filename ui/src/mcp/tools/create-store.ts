// ui/src/mcp/tools/create-store.ts
// MCP wrapper for POST /api/admin/stores. First MCP tool that performs a
// direct create (not "propose then approve") — gated by:
//   1. The originating user must be an admin session (forwarded via the
//      cookie header that mcpFetch() attaches from AsyncLocalStorage).
//   2. The MCP request must carry x-service-token matching WDG_SERVICE_TOKEN
//      (verified by the route via verifyMcpServiceToken).
//
// See docs/superpowers/specs/2026-06-08-agent-create-store-design.md §4.1.

import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

const STORE_CODE_RE = /^[a-z][a-z0-9_]{1,31}$/;

const CreateStoreInput = z.object({
  brand: brandParamSchema.describe('Existing brand code: gelatomiiix | bonjur | tamkoko'),
  store_code: z.string().regex(STORE_CODE_RE, 'store_code must match ^[a-z][a-z0-9_]{1,31}$'),
  store_name: z.string().min(1).describe('Human-readable store name shown in the UI'),
  rule_snapshot_source_store_code: z.string().optional()
    .describe('Optional: copy cfg tables from a sibling store (must be same brand, enabled)'),
  rule_snapshot_tables: z.array(z.string()).optional()
    .describe('Optional whitelist. Default: ["bank_rule_map"]. v1 only supports tables with a store_code column.'),
});

export const createStoreTool = {
  name: 'create_store',
  description: `Create a new store under an existing brand. Same behavior as the admin /u/admin/stores page: writes ops.stores + {brand}_cfg.dim_store, and optionally copies cfg rule snapshots from a sibling store. The new store is immediately importable, viewable in the UI, and queryable by MCP.

**Auth**: requires the calling user to be logged in as an admin AND the server to have WDG_SERVICE_TOKEN configured. The service token is sent as the x-service-token header.

**Idempotency**: calling twice with the same (brand, store_code) is a no-op update of store_name — rule snapshot is NOT re-applied (avoids duplicating rows). The response sets store.updated = true in that case.

**Parameters**:
- brand (required): existing brand code in ops.brands
- store_code (required): new store code, must match ^[a-z][a-z0-9_]{1,31}$
- store_name (required): human-readable name
- rule_snapshot_source_store_code (optional): sibling store code, same brand, must be enabled
- rule_snapshot_tables (optional): whitelist of cfg table names to copy. Default: ["bank_rule_map"]

**Response**: { ok, store, rule_snapshot } where rule_snapshot = { applied, source_store_code, tables_copied, tables_skipped } or undefined if no snapshot source was requested.`,
  inputSchema: CreateStoreInput,
  async execute(params: z.infer<typeof CreateStoreInput>) {
    const serviceToken = process.env.WDG_SERVICE_TOKEN;
    if (!serviceToken) {
      throw new Error('WDG_SERVICE_TOKEN not configured on server');
    }
    const res = await mcpFetch('/api/admin/stores', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-service-token': serviceToken,
      },
      body: JSON.stringify(params),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      const code = json?.code ?? `http_${res.status}`;
      const message = json?.error ?? `create_store failed (HTTP ${res.status})`;
      throw new Error(`${code}: ${message}`);
    }
    // Pass through the spec-shaped response: { store, rule_snapshot }.
    return {
      store: json.store ?? json.data ?? null,
      rule_snapshot: json.rule_snapshot ?? null,
    };
  },
};
