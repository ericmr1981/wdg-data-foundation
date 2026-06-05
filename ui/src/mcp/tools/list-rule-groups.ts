import { z } from 'zod';

const ListRuleGroupsInput = z.object({
  brand: z.enum(['gelatomiiix', 'yufeng', 'bonjur']).optional().default('yufeng')
    .describe('Brand code (default yufeng = gelatomiiix)'),
});

export const listRuleGroupsTool = {
  name: 'list_rule_groups',
  description: `List classification rule groups. Rules can be grouped for organization and bulk operations.

**Parameters**:
- brand (optional): gelatomiiix | yufeng | bonjur, default yufeng

**Response**: rows of { group_id, group_name, sort_order, rule_count, ... }`,
  inputSchema: ListRuleGroupsInput,
  async execute(params: z.infer<typeof ListRuleGroupsInput>) {
    const { brand = 'yufeng' } = params;
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const qs = new URLSearchParams({ brand });
    const res = await fetch(`${baseUrl}/api/rule-groups?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    if (!res.ok) throw new Error(`list_rule_groups failed: ${await res.text()}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Unknown error');
    return json.data;
  },
};
