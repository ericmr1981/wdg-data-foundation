import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const GetRulesHistoryInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  rule_id: z.number().int().positive().optional()
    .describe('Filter by specific rule ID (recommended for tracking a single rule)'),
  limit: z.number().int().positive().max(200).optional().default(50)
    .describe('Max rows (default 50, max 200)'),
});

export const getRulesHistoryTool = {
  name: 'get_rules_history',
  description: `Get classification rule change history. Shows who changed what rule, when, and from→to values (lvl1, match_value, match_field, status).

**Use case**: Audit rule changes; investigate why a particular txn was classified a certain way by tracing back to the rule edit.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- rule_id (optional): filter by specific rule
- limit (optional): max rows, default 50

**Response**: rows of { id, rule_id, action (insert/update/delete), changed_by, changed_at, old_value, new_value, ... }`,
  inputSchema: GetRulesHistoryInput,
  async execute(params: z.infer<typeof GetRulesHistoryInput>) {
    const { brand = 'gelatomiiix', rule_id, limit = 50 } = params;
    const qs = new URLSearchParams({ brand, limit: String(limit) });
    if (rule_id !== undefined) qs.set('rule_id', String(rule_id));
    const res = await mcpFetch(`/api/rules/history?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'get_rules_history');
    return (json as Record<string, unknown>).data;
  },
};
