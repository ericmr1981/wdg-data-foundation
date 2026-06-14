import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

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
    const json = await assertApiSuccess(res, 'list_rule_groups');
    return (json as Record<string, unknown>).data;
  },
};
