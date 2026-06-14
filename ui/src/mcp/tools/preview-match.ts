import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { brandParamSchema } from '@/lib/brand-param';
import { assertApiSuccess } from '@/lib/api-error';

const PreviewMatchInput = z.object({
  brand: brandParamSchema.optional().default('gelatomiiix')
    .describe('Brand code: gelatomiiix | bonjur | tamkoko'),
  match_value: z.string().min(1).describe('Match keyword to preview (e.g. 美团 / 微信 / 房租)'),
  limit: z.number().int().min(1).max(100).optional().default(20)
    .describe('Max sample rows to return (default 20)'),
});

export const previewMatchTool = {
  name: 'preview_match',
  description: `Preview which historical bank transactions a candidate match_value would hit. Useful before creating a new rule — shows the rule's likely impact.

**Parameters**:
- brand (optional): gelatomiiix | bonjur | tamkoko, default gelatomiiix
- match_value (required): keyword to test (e.g. 美团 / 微信 / 房租)
- limit (optional): max sample rows, default 20

**Response**: { total_count, samples: [{ txn_id, txn_time, summary, amount, ... }] }`,
  inputSchema: PreviewMatchInput,
  async execute(params: z.infer<typeof PreviewMatchInput>) {
    const { brand = 'gelatomiiix', match_value, limit = 20 } = params;
    const qs = new URLSearchParams({ brand, match_value, limit: String(limit) });

    const res = await mcpFetch(`/api/match/preview?${qs}`, {
      headers: { 'x-mcp-session': 'internal' },
    });

    const json = await assertApiSuccess(res, 'preview_match');
    return (json as Record<string, unknown>).data;
  },
};
