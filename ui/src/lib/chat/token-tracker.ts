// Per-session token accumulator. Soft-compresses the system prompt at
// SOFT_LIMIT; hard-aborts at HARD_LIMIT.

let softLimit = 80_000;
let hardLimit = 200_000;

export type TokenLevel = 'normal' | 'soft' | 'hard';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  lastReportedAt: number;
}

export function getTokenLimits(): { soft: number; hard: number } {
  return { soft: softLimit, hard: hardLimit };
}

export function setTokenLimits(soft: number, hard: number): void {
  softLimit = soft;
  hardLimit = hard;
}

export function createTokenTracker() {
  let inputTokens = 0;
  let outputTokens = 0;
  let lastReportedAt = 0;

  function level(): TokenLevel {
    const total = inputTokens + outputTokens;
    if (total >= hardLimit) return 'hard';
    if (total >= softLimit) return 'soft';
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
