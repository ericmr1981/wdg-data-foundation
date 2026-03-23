import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';

// GET /api/match?brand=xxx - 获取未分类列表
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);
    const month = searchParams.get('month');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const schema = getDmSchema(brand);

    let query = `
      SELECT month, bank_txn_id, txn_time, counterparty_name, summary, memo,
             in_amt, out_amt, balance_amt, source_file_id, combined_text
      FROM ${schema}.v_unclassified_detail
    `;
    const params: any[] = [];

    if (month) {
      query += ' WHERE month = $1';
      params.push(month);
    }

    query += ' ORDER BY txn_time DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(pageSize, (page - 1) * pageSize);

    const result = await pool.query(query, params);

    // 获取总数
    let countQuery = `SELECT COUNT(*) as total FROM ${schema}.v_unclassified_detail`;
    if (month) {
      countQuery += ' WHERE month = $1';
    }
    const countResult = await pool.query(countQuery, month ? [month] : []);
    const total = parseInt(countResult.rows[0].total);

    return NextResponse.json({
      success: true,
      data: {
        items: result.rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error: any) {
    const pgCode = error?.code;
    if (pgCode === '42P01') {
      return NextResponse.json({
        success: true,
        data: { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 },
        note: 'v_unclassified_detail not ready'
      });
    }

    console.error('Error fetching unclassified:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch unclassified' }, { status: 500 });
  }
}

// POST /api/match - 创建/更新 override（body.brand 可选，默认 yufeng）
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    const { bank_txn_id, lvl1, lvl2, note } = body;

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!bank_txn_id || !lvl1) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const schema = getDmSchema(brand);

    await pool.query(
      `
      INSERT INTO ${schema}.bank_txn_override (bank_txn_id, lvl1, lvl2, note, created_by)
      VALUES ($1, $2, $3, $4, 'ui')
      ON CONFLICT (bank_txn_id) DO UPDATE SET
        lvl1 = EXCLUDED.lvl1,
        lvl2 = EXCLUDED.lvl2,
        note = EXCLUDED.note,
        updated_at = now()
      `,
      [bank_txn_id, lvl1, lvl2 || null, note || null]
    );

    return NextResponse.json({ success: true, message: 'Override saved' });
  } catch (error) {
    console.error('Error creating override:', error);
    return NextResponse.json({ success: false, error: 'Failed to create override' }, { status: 500 });
  }
}

// PUT /api/match - 批量创建 override（body.brand 可选，默认 yufeng）
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    const { bank_txn_ids, lvl1, lvl2, note } = body;

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!bank_txn_ids || !Array.isArray(bank_txn_ids) || bank_txn_ids.length === 0 || !lvl1) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const schema = getDmSchema(brand);

    for (const bank_txn_id of bank_txn_ids) {
      await pool.query(
        `
        INSERT INTO ${schema}.bank_txn_override (bank_txn_id, lvl1, lvl2, note, created_by)
        VALUES ($1, $2, $3, $4, 'ui')
        ON CONFLICT (bank_txn_id) DO UPDATE SET
          lvl1 = EXCLUDED.lvl1,
          lvl2 = EXCLUDED.lvl2,
          note = EXCLUDED.note,
          updated_at = now()
        `,
        [bank_txn_id, lvl1, lvl2 || null, note || null]
      );
    }

    return NextResponse.json({ success: true, message: `Batch override saved for ${bank_txn_ids.length} items` });
  } catch (error) {
    console.error('Error creating batch override:', error);
    return NextResponse.json({ success: false, error: 'Failed to create override' }, { status: 500 });
  }
}
