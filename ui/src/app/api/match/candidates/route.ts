import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getOdsSchema, normalizeBrand } from '@/lib/brand-server';
import { extract_candidates_for_unclassified } from '@/lib/candidate-extractor';

// GET /api/match/candidates?brand=xxx&bank_txn_id=123
export async function GET(request: Request) {
  const isMcp = request.headers.get('x-mcp-session') === 'internal';
  if (!isMcp) {
    const { getSessionUser, assertRole } = await import('@/lib/auth-server');
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);
    const bankTxnId = searchParams.get('bank_txn_id');

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!bankTxnId) {
      return NextResponse.json({ success: false, error: 'Missing bank_txn_id' }, { status: 400 });
    }

    const odsSchema = getOdsSchema(brand);

    const result = await pool.query(
      `SELECT counterparty_name, summary, memo, purpose
       FROM ${odsSchema}.bank_txn
       WHERE id = $1`,
      [bankTxnId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Bank txn not found' }, { status: 404 });
    }

    const txn = result.rows[0];

    const candidates = extract_candidates_for_unclassified({
      counterparty_name: txn.counterparty_name || '',
      summary: txn.summary || '',
      memo: txn.memo || '',
      purpose: txn.purpose || ''
    }, 8);

    return NextResponse.json({
      success: true,
      data: {
        bank_txn_id: parseInt(bankTxnId),
        candidates
      }
    });
  } catch (error: any) {
    console.error('Error fetching candidates:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
