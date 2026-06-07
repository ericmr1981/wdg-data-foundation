// ui/src/lib/analyze-unclassified.ts
// Helper for the analyze-unclassified route. Pure LLM helpers live in
// analyze-unclassified.pure.ts so node --test can import them without
// pulling in the chat lib or next/server. This module re-exports the pure
// helpers and adds the Anthropic SDK call.

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt } from '@/lib/chat/prompt';
import { getAgentConfig } from '@/lib/chat/agent-config-store';
import {
  buildUserPrompt,
  parseModelResponse,
  parseInput,
  BRANDS,
  MAX_LIMIT,
} from './analyze-unclassified.pure.ts';
import type {
  UnclassifiedTxnForAnalysis,
  LlmProposalRecord,
  AnalysisResult,
  RouteInput,
} from './analyze-unclassified.pure.ts';

// Re-export the pure helpers so external callers (route handlers, future
// tests) can import everything from a single entry point.
export {
  buildUserPrompt,
  parseModelResponse,
  parseInput,
  BRANDS,
  MAX_LIMIT,
};
export type {
  UnclassifiedTxnForAnalysis,
  LlmProposalRecord,
  AnalysisResult,
  RouteInput,
};

export interface RunLlmOpts {
  client?: Anthropic;            // injectable for tests
  model?: string;                // overrides getAgentConfig
  brand: string;
  txns: UnclassifiedTxnForAnalysis[];
}

export async function runLlmAnalysis(opts: RunLlmOpts): Promise<LlmProposalRecord[]> {
  const cfg = getAgentConfig();
  const model = opts.model ?? cfg.model ?? 'claude-opus-4-8';
  const client = opts.client ?? new Anthropic();
  const systemPrompt = buildSystemPrompt({ brand: opts.brand, page: 'batch-analyze' }, []);
  const userPrompt = buildUserPrompt(opts.brand, opts.txns);
  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');
  return parseModelResponse(text);
}
