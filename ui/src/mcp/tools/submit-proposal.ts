import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const RecordSchema = z.object({
  bank_txn_id:  z.number().int().positive().describe('Bank transaction ID'),
  type:         z.enum(['type1', 'type2']).describe('Proposal type: type1=LLM has recommendation, type2=info missing'),
  llm_proposal: z.object({
    lvl1_code:    z.string().describe('Level 1 category code'),
    lvl2_code:    z.string().nullable().optional().describe('Level 2 category code'),
    keyword:      z.string().optional().describe('Keyword for rule match_value'),
    match_field: z.enum(['summary', 'memo', 'purpose', 'counterparty_name']).optional().describe('Field to match on'),
    match_field2: z.enum(['summary', 'memo', 'purpose', 'counterparty_name']).nullable().optional().describe('Second field for AND match'),
    match_value2: z.string().nullable().optional().describe('Second keyword for AND match'),
    confidence:  z.string().optional().describe('LLM confidence: high|medium|low'),
    reasoning:   z.string().optional().describe('LLM reasoning text'),
  }).nullable().optional().describe('LLM classification recommendation (required for type1)'),
  missing_fields: z.array(z.string()).nullable().optional().describe('List of missing fields (for type2)'),
  reasoning:    z.string().optional().describe('LLM reasoning text'),
});

const SubmitProposalInput = z.object({
  source_file_id: z.number().int().positive().describe('Source file ID from upload response'),
  brand:         z.string().describe('Brand code: yufeng | gelatomiiix | bonjur'),
  records:       z.array(RecordSchema).min(1).describe('Array of proposal records'),
});

export const submitProposalTool = {
  name: 'submit_proposal',
  description: 'Submit LLM-generated classification proposals for bank transactions into the approval queue.',
  inputSchema: SubmitProposalInput,
  async execute(params: z.infer<typeof SubmitProposalInput>) {

    // Transform flat record fields into the API's nested format
    const apiRecords = params.records.map(r => ({
      bank_txn_id: r.bank_txn_id,
      type: r.type,
      llm_proposal: r.llm_proposal ? {
        lvl1_code:    r.llm_proposal.lvl1_code,
        lvl2_code:    r.llm_proposal.lvl2_code,
        keyword:      r.llm_proposal.keyword,
        match_field:  r.llm_proposal.match_field,
        match_field2: r.llm_proposal.match_field2 ?? null,
        match_value2: r.llm_proposal.match_value2 ?? null,
        confidence:   r.llm_proposal.confidence,
        reasoning:    r.llm_proposal.reasoning,
      } : null,
      missing_fields: r.missing_fields ?? null,
      reasoning: r.reasoning ?? null,
    }));

    const body = {
      source_file_id: params.source_file_id,
      brand: params.brand,
      records: apiRecords,
    };

    const res = await mcpFetch(`/api/approval/proposals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mcp-session': 'internal',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`submit_proposal failed: ${err}`);
    }

    return await res.json();
  },
};
