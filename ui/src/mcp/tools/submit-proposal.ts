import { z } from 'zod';

const SubmitProposalInput = z.object({
  brand:       z.string().describe('Brand code: yufeng | gelatomiiix | bonjur'),
  bank_txn_id: z.number().int().positive().describe('Bank transaction ID'),
  direction:   z.enum(['in', 'out']).describe('Transaction direction'),
  lvl1_code:   z.string().describe('Level 1 category code'),
  lvl2_code:   z.string().nullable().optional().describe('Level 2 category code'),
  match_field: z.enum(['summary', 'memo', 'purpose', 'counterparty_name']).describe('Field to match on'),
  match_value: z.string().describe('Value to match'),
  priority:    z.number().int().positive().optional().default(1000),
  note:        z.string().optional(),
});

export const submitProposalTool = {
  name: 'submit_proposal',
  description: 'Submit a classification rule proposal for a bank transaction via the approval workflow.',
  inputSchema: SubmitProposalInput,
  async execute(params: z.infer<typeof SubmitProposalInput>) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
    const res = await fetch(`${baseUrl}/api/approval/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-session': 'internal',
      },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`submit_proposal failed: ${err}`);
    }
    return await res.json();
  },
};