import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { assertApiSuccess } from '@/lib/api-error';

const GetProposalInput = z.object({
  proposal_id: z.number().int().positive().describe('Proposal ID (integer from approval queue)'),
});

export const getProposalTool = {
  name: 'get_proposal',
  description: `Get full details of a single approval proposal, including the LLM reasoning, proposed rule (lvl1/lvl2/keyword/match_field), and current status (pending / approved / rejected).

**Use case**: After submit_proposal returns, look up the proposal to check status or surface reasoning for human review.

**Parameters**:
- proposal_id (required): proposal ID returned by submit_proposal

**Response**: { id, status, bank_txn_id, type, llm_proposal, missing_fields, reasoning, created_at, reviewed_at, reviewer, ... }`,
  inputSchema: GetProposalInput,
  async execute(params: z.infer<typeof GetProposalInput>) {
    const { proposal_id } = params;
    const res = await mcpFetch(`/api/approval/proposals/${proposal_id}`, {
      headers: { 'x-mcp-session': 'internal' },
    });
    const json = await assertApiSuccess(res, 'get_proposal');
    return (json as Record<string, unknown>).data;
  },
};
