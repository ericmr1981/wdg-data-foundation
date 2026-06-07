// ui/src/app/api/admin/analyze-unclassified/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireServiceToken } from '@/lib/service-auth';
import { getErrorMessage } from '@/lib/query-types';
import pool from '@/lib/db';
import {
  runLlmAnalysis,
  BRANDS,
  MAX_LIMIT,
  parseInput,
  type UnclassifiedTxnForAnalysis,
  type LlmProposalRecord,
} from '@/lib/analyze-unclassified';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BANK_TABLE_BY_BRAND: Record<string, { bank_table: string; classified_schema: string; classified_snapshot: string }> = {
  tamkoko:     { bank_table: 'brand_tamkoko_ods.bank_txn',     classified_schema: 'brand_tamkoko_dm',     classified_snapshot: 'bank_txn_classified_snapshot' },
  gelatomiiix: { bank_table: 'brand_gelatomiiix_ods.bank_txn', classified_schema: 'brand_gelatomiiix_dm', classified_snapshot: 'bank_txn_classified_snapshot' },
  bonjur:      { bank_table: 'bonjur_ods.bank_txn',             classified_schema: 'bonjur_dm',             classified_snapshot: 'bank_txn_classified_snapshot' },
};

async function loadTxns(brand: string, ids: number[] | undefined, limit: number): Promise<UnclassifiedTxnForAnalysis[]> {
  const cfg = BANK_TABLE_BY_BRAND[brand];
  const params: unknown[] = [];
  let where = 'c.bank_txn_id IS NULL';
  if (ids && ids.length > 0) {
    where = `t.id = ANY($${params.length + 1}::int[])`;
    params.push(ids);
  }
  const sql = `
    SELECT t.id AS bank_txn_id, t.txn_time, t.summary, t.memo, t.purpose,
           t.counterparty_name, t.in_amt, t.out_amt, t.source_file_id
    FROM ${cfg.bank_table} t
    LEFT JOIN ${cfg.classified_schema}.${cfg.classified_snapshot} c ON c.bank_txn_id = t.id
    WHERE ${where}
    ORDER BY t.txn_time DESC
    LIMIT ${limit}
  `;
  const { rows } = await pool.query(sql, params);
  return rows as UnclassifiedTxnForAnalysis[];
}

export async function POST(req: NextRequest) {
  // 1. service token auth
  const svc = await requireServiceToken(req, 'sweep-notification');
  if (!svc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // 2. parse body
  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  const parsed = parseInput(raw);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // 3. load unclassified txns (also fetches source_file_id for the INSERT)
  let txns: (UnclassifiedTxnForAnalysis & { source_file_id: number })[];
  try {
    txns = await loadTxns(parsed.brand, parsed.unclassified_txn_ids, parsed.limit);
  } catch (e) {
    return NextResponse.json({ error: 'load failed: ' + getErrorMessage(e) }, { status: 500 });
  }
  if (txns.length === 0) {
    return NextResponse.json({ batch_id: null, proposals_created: 0, errors: ['no unclassified txns'] });
  }

  // 4. call Claude
  let llmRecords: LlmProposalRecord[];
  try {
    llmRecords = await runLlmAnalysis({ brand: parsed.brand, txns });
  } catch (e) {
    return NextResponse.json(
      { batch_id: null, proposals_created: 0, errors: ['claude_unavailable: ' + getErrorMessage(e)] },
      { status: 502 }
    );
  }

  // 5. write proposals to ops.approval_proposal
  const batchId = randomUUID();
  let proposalsCreated = 0;
  const errors: string[] = [];
  // Build a map of bank_txn_id -> source_file_id from the loaded rows
  const sourceFileIdByBankTxnId = new Map<number, number>();
  for (const t of txns) sourceFileIdByBankTxnId.set(t.bank_txn_id, t.source_file_id);

  for (const rec of llmRecords) {
    try {
      const lp = rec.llm_proposal;
      // source_file_id and brand_code are NOT NULL on ops.approval_proposal.
      const source_file_id = sourceFileIdByBankTxnId.get(rec.bank_txn_id);
      if (source_file_id === undefined) {
        errors.push(`txn ${rec.bank_txn_id}: not in loaded unclassified set`);
        continue;
      }
      await pool.query(
        `INSERT INTO ops.approval_proposal
           (batch_id, source_file_id, bank_txn_id, brand_code, type, status,
            llm_lvl1_code, llm_lvl2_code, llm_keyword, llm_match_field,
            llm_confidence, llm_reasoning, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, now())
         ON CONFLICT (proposal_id) DO NOTHING`,
        [
          batchId, source_file_id, rec.bank_txn_id, parsed.brand, rec.type,
          lp?.lvl1_code ?? null, lp?.lvl2_code ?? null, lp?.keyword ?? null,
          lp?.match_field ?? null, lp?.confidence ?? null, rec.reasoning ?? null,
        ]
      );
      proposalsCreated++;
    } catch (e) {
      errors.push(`txn ${rec.bank_txn_id}: ${getErrorMessage(e)}`);
    }
  }

  // silence unused import warnings
  void BRANDS; void MAX_LIMIT;

  return NextResponse.json({ batch_id: batchId, proposals_created: proposalsCreated, errors });
}
