// Per-session token accumulator. Soft-compresses the system prompt at
// SOFT_LIMIT; hard-aborts at HARD_LIMIT.

export const SOFT_LIMIT = 80_000;
export const HARD_LIMIT = 200_000;

export type TokenLevel = 'normal' | 'soft' | 'hard';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  lastReportedAt: number;
}

export function createTokenTracker() {
  let inputTokens = 0;
  let outputTokens = 0;
  let lastReportedAt = 0;

  function level(): TokenLevel {
    const total = inputTokens + outputTokens;
    if (total >= HARD_LIMIT) return 'hard';
    if (total >= SOFT_LIMIT) return 'soft';
    return 'normal';
  }

  return {
    record(input: number, output: number): { usage: TokenUsage; level: TokenLevel } {
      inputTokens += input;
      outputTokens += output;
      lastReportedAt = Date.now();
      return {
        usage: { inputTokens, outputTokens, lastReportedAt },
        level: level(),
      };
    },
    getUsage(): TokenUsage {
      return { inputTokens, outputTokens, lastReportedAt };
    },
  };
}
