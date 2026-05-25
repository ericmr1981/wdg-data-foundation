import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { ApprovalRecord } from '@/lib/query-types';

// POST /api/approval/proposals - Agent submits LLM-generated proposals
export async function POST(request: Request) {
  // Allow x-mcp-session: internal header for MCP tool calls (bypass auth)
  const isMcp = request.headers.get('x-mcp-session') === 'internal';
  if (!isMcp) {
    const user = await getSessionUser();
    try {
      assertRole(user, ['admin', 'operator']);
    } catch {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const body = await request.json();
    const { source_file_id, brand, records } = body as {
      source_file_id: number;
      brand: string;
      records: ApprovalRecord[];
    };

    if (!source_file_id || !brand || !records || !Array.isArray(records) || records.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing required fields: source_file_id, brand, records' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Generate batch_id
      const batchResult = await client.query('SELECT gen_random_uuid() as batch_id');
      const batch_id = batchResult.rows[0].batch_id;

      for (const record of records) {
        if (!record.bank_txn_id || !record.type) {
          throw Object.assign(new Error('Each record must have bank_txn_id and type'), { status: 400 });
        }
        await client.query(
          `
          INSERT INTO ops.approval_proposal (
            batch_id, source_file_id, bank_txn_id, brand_code, type, status,
            llm_lvl1_code, llm_lvl2_code, llm_keyword, llm_match_field,
            llm_confidence, llm_reasoning, llm_missing_fields
          )
          VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, $9, $10, $11, $12)
          `,
          [
            batch_id,
            source_file_id,
            record.bank_txn_id,
            brand,
            record.type,
            record.llm_proposal?.lvl1_code || null,
            record.llm_proposal?.lvl2_code || null,
            record.llm_proposal?.keyword || null,
            record.llm_proposal?.match_field || null,
            record.llm_proposal?.confidence || null,
            record.llm_proposal?.reasoning || null,
            record.llm_proposal ? JSON.stringify(record.llm_proposal) : null
          ]
        );
      }

      await client.query('COMMIT');

      const countRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM ops.approval_proposal WHERE batch_id = $1`,
        [batch_id]
      );

      return NextResponse.json({
        success: true,
        batch_id,
        count: parseInt(countRes.rows[0].cnt),
        created_at: new Date().toISOString()
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    const status = error?.status || 500;
    if (status === 400) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('Error creating approval proposals:', error);
    return NextResponse.json({ success: false, error: 'Failed to create proposals' }, { status: 500 });
  }
}

// GET /api/approval/proposals?batch_id=&brand=&status=&month=&limit=&offset=
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const batch_id = searchParams.get('batch_id');
  const brand = searchParams.get('brand');
  const status = searchParams.get('status');
  const month = searchParams.get('month');
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');

  try {
    const user = await getSessionUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let query = `
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
        FROM ${getTxnTable(brand)} x
        WHERE x.id = p.bank_txn_id
        LIMIT 1
      ) t ON true
      WHERE 1=1
    `;
    const params: any[] = [];
    let idx = 1;

    if (batch_id) {
      query += ` AND p.batch_id = $${idx++}`;
      params.push(batch_id);
    }
    if (brand) {
      query += ` AND p.brand_code = $${idx++}`;
      params.push(brand);
    }
    if (status) {
      query += ` AND p.status = $${idx++}`;
      params.push(status);
    }
    if (month) {
      query += ` AND date_trunc('month', t.txn_time)::date = $${idx++}`;
      params.push(month.includes('-') ? month : `${month}-01`);
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: any) {
    // Table not ready → empty array
    if (error?.code === '42P01') {
      return NextResponse.json({ success: true, data: [] });
    }
    console.error('Error fetching approval proposals:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch proposals' }, { status: 500 });
  }
}

function getTxnTable(brand: string | null): string {
  if (!brand) return 'yufeng_ods.bank_txn';
  if (brand === 'yufeng' || brand === 'bonjur') return `${brand}_ods.bank_txn`;
  return `brand_${brand}_ods.bank_txn`;
}