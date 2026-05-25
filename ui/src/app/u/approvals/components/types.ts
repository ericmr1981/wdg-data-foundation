import type { ApprovalProposal } from '@/lib/query-types';

// Extended row type with transaction fields and local `use_llm` flag
export interface ProposalRow extends ApprovalProposal {
  txn_time?: string | null;
  summary?: string | null;
  memo?: string | null;
  counterparty_name?: string | null;
  in_amt?: number | null;
  out_amt?: number | null;
  use_llm?: boolean; // local: agree with LLM (type1 default true)
}