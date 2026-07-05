import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const GetRulesHistoryInput = z.object({
  brand: z.enum(['gelatomiiix', 'yufeng', 'bonjur', 'tamkoko']).optional().default('yufeng')
    .describe('Brand code (default yufeng = gelatomiiix)'),
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
- brand (optional): gelatomiiix | yufeng | bonjur, default yufeng
- rule_id (optional): filter by specific rule
- limit (optional): max rows, default 50

**Response**: rows of { id, rule_id, action (insert/update/delete), changed_by, changed_at, old_value, new_value, ... }`,
  inputSchema: GetRulesHistoryInput,
  async execute(params: z.infer<typeof GetRulesHistoryInput>) {
    const { brand = 'yufeng', rule_id, limit = 50 } = params;
    const qs = new URLSearchParams({ brand, limit: String(limit) });
    if (rule_id !== undefined) qs.set('rule_id', String(rule_id));
    const res = await mcpFetch(`/api/rules/history?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`get_rules_history failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
