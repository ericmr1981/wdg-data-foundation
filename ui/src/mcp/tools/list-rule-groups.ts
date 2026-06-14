import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';

const ListRuleGroupsInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
});

export const listRuleGroupsTool = {
  name: 'list_rule_groups',
  description: `List classification rule groups. Rules can be grouped for organization and bulk operations.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix

**Response**: rows of { group_id, group_name, sort_order, rule_count, ... }`,
  inputSchema: ListRuleGroupsInput,
  async execute(params: z.infer<typeof ListRuleGroupsInput>) {
    const { brand = 'gelatomiiix' } = params;
    const qs = new URLSearchParams({ brand });
    const res = await mcpFetch(`/api/rule-groups?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`list_rule_groups failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
