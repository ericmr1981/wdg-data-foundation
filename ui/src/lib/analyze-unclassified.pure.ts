// ui/src/lib/analyze-unclassified.pure.ts
// Pure (no Anthropic SDK / agent config / next/server) helpers. Split from
// analyze-unclassified.ts and the route file so node --test can import these
// without resolving the TS path-aliases used by the chat lib or the
// `next/server` module. Mirrors the project's existing pattern
// (ui/src/lib/notification-queries.ts).
//
// Types are co-located here so the test can import everything it needs from
// one file.

export interface UnclassifiedTxnForAnalysis {
  bank_txn_id: number;
  source_file_id: number;
  txn_time: string;
  summary: string | null;
  memo: string | null;
  purpose: string | null;
  counterparty_name: string | null;
  in_amt: number;
  out_amt: number;
}

export interface LlmProposalRecord {
  bank_txn_id: number;
  type: 'type1' | 'type2';
  llm_proposal: {
    lvl1_code: string;
    lvl2_code: string | null;
    keyword: string | null;
    match_field: 'summary' | 'memo' | 'purpose' | 'counterparty_name' | null;
    confidence: 'high' | 'medium' | 'low' | null;
    reasoning: string | null;
  } | null;
  reasoning: string | null;
}

export interface AnalysisResult {
  batch_id: string;
  proposals: LlmProposalRecord[];
  errors: string[];
  model_used: string;
}

export const BRANDS = new Set(['tamkoko', 'gelatomiiix', 'bonjur']);
export const MAX_LIMIT = 50;

export interface RouteInput {
  brand: string;
  limit: number;
  unclassified_txn_ids?: number[];
}

export function parseInput(body: unknown): RouteInput | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'invalid body' };
  const b = body as Record<string, unknown>;
  const brand = typeof b.brand === 'string' ? b.brand : '';
  if (!BRANDS.has(brand)) return { error: `unknown brand: ${brand}` };
  const limit = typeof b.limit === 'number' ? b.limit : MAX_LIMIT;
  if (limit <= 0 || limit > MAX_LIMIT) return { error: `limit must be 1..${MAX_LIMIT}` };
  const ids = Array.isArray(b.unclassified_txn_ids) ? b.unclassified_txn_ids : undefined;
  if (ids && (!ids.every((x) => typeof x === 'number' && Number.isInteger(x) && x > 0))) {
    return { error: 'unclassified_txn_ids must be positive integers' };
  }
  return { brand, limit, unclassified_txn_ids: ids as number[] | undefined };
}

export function buildUserPrompt(brand: string, txns: UnclassifiedTxnForAnalysis[]): string {
  return `你是 wdg-data-platform 的财务分类员。
以下是 ${brand} 品牌当前 ${txns.length} 条未配条目的银行流水(JSON array)。
请为每条输出 {bank_txn_id, type, lvl1_code, lvl2_code, keyword, match_field, confidence, reasoning}, 包装成一个 JSON array 返回。
- bank_txn_id 必须原样回显输入里的 id 字段, 用于回写 proposals 表。
- type 必须是 "type1" (一阶规则: 关键字直接命中) 或 "type2" (二阶: 关键字+对手方/收付方向等组合条件)。type1 用于单关键字即可判定的; type2 用于需要 AND 条件的。
不要调用任何工具, 直接给 JSON。

[嵌入未配条目]
${JSON.stringify(txns, null, 2)}`;
}

export function parseModelResponse(text: string): LlmProposalRecord[] {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const json = (m ? m[1] : text).trim();
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Model response is not a JSON array');
  }
  return parsed as LlmProposalRecord[];
}
