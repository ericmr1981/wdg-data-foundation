import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/approval/proposals/[id]
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    // First fetch brand_code to determine txn table
    const lookupRes = await pool.query(
      `SELECT proposal_id, brand_code FROM ops.approval_proposal WHERE proposal_id = $1`,
      [id]
    );
    if (lookupRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const brand: string = lookupRes.rows[0].brand_code;
    const txnTable = brand ? getTxnTable(brand) : getTxnTable(null);

    const result = await pool.query(
      `
      SELECT
        p.proposal_id, p.batch_id, p.source_file_id, p.bank_txn_id, p.brand_code,
        p.type, p.status,
        p.llm_lvl1_code, p.llm_lvl2_code, p.llm_keyword, p.llm_match_field,
        p.llm_confidence, p.llm_reasoning, p.llm_missing_fields,
        p.final_lvl1_code, p.final_lvl2_code, p.final_keyword, p.final_match_field,
        p.user_note, p.resolved_by,
        p.created_at, p.resolved_at,
        t.txn_time, t.summary, t.memo, t.counterparty_name, t.in_amt, t.out_amt
      FROM ops.approval_proposal p
      LEFT JOIN LATERAL (
        SELECT txn_time, summary, memo, counterparty_name, in_amt, out_amt
        FROM ${txnTable} x
        WHERE x.id = p.bank_txn_id
        LIMIT 1
      ) t ON true
      WHERE p.proposal_id = $1
      `,
      [id]
    );

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: null, note: 'table not ready' });
    }
    console.error('Error fetching proposal:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch proposal' }, { status: 500 });
  }
}

// PUT /api/approval/proposals/[id] - User modifies a proposal
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { final_lvl1_code, final_lvl2_code, final_keyword, final_match_field, user_note } = body;

    const result = await pool.query(
      `
      UPDATE ops.approval_proposal
      SET status = 'modified',
          final_lvl1_code = COALESCE($1, final_lvl1_code),
          final_lvl2_code = COALESCE($2, final_lvl2_code),
          final_keyword = COALESCE($3, final_keyword),
          final_match_field = COALESCE($4, final_match_field),
          user_note = COALESCE($5, user_note)
      WHERE proposal_id = $6
      RETURNING proposal_id, status, final_lvl1_code, final_lvl2_code, final_keyword, final_match_field, user_note
      `,
      [final_lvl1_code, final_lvl2_code, final_keyword, final_match_field, user_note, id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    console.error('Error updating proposal:', error);
    return NextResponse.json({ success: false, error: 'Failed to update proposal' }, { status: 500 });
  }
}

function getTxnTable(brand: string | null): string {
  if (!brand) return 'yufeng_ods.bank_txn';
  if (brand === 'yufeng' || brand === 'bonjur') return `${brand}_ods.bank_txn`;
  return `brand_${brand}_ods.bank_txn`;
}