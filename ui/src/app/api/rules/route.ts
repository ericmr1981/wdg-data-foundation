import { NextResponse } from 'next/server';
import pool from '@/lib/db';

function getRuleTable(brand: string) {
  if (brand === 'yufeng') return 'yufeng_cfg.bank_rule_map';
  if (brand === 'bonjur') return 'bonjur_cfg.bank_rule_map';
  return null;
}

// GET /api/rules?brand=xxx - 获取规则列表
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand') || 'yufeng';
  const table = getRuleTable(brand);

  if (!table) {
    return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
  }

  try {
    const result = await pool.query(`
      SELECT rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
      FROM ${table}
      ORDER BY priority ASC, rule_id ASC
    `);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching rules:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch rules' }, { status: 500 });
  }
}

// POST /api/rules - 创建规则（body.brand 可选，默认 yufeng）
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const brand = body.brand || 'yufeng';
    const table = getRuleTable(brand);

    if (!table) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const { priority, direction, match_field, match_value, lvl1, lvl2, enabled } = body;

    if (!priority || !direction || !match_field || !match_value || !lvl1) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const result = await pool.query(
      `
      INSERT INTO ${table} (priority, direction, match_field, match_value, lvl1, lvl2, enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
      `,
      [priority, direction, match_field, match_value, lvl1, lvl2 || null, enabled !== false]
    );

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to create rule' }, { status: 500 });
  }
}

// PUT /api/rules - 更新规则（body.brand 可选，默认 yufeng）
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const brand = body.brand || 'yufeng';
    const table = getRuleTable(brand);

    if (!table) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const { rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled } = body;

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    const result = await pool.query(
      `
      UPDATE ${table}
      SET priority = COALESCE($1, priority),
          direction = COALESCE($2, direction),
          match_field = COALESCE($3, match_field),
          match_value = COALESCE($4, match_value),
          lvl1 = COALESCE($5, lvl1),
          lvl2 = $6,
          enabled = COALESCE($7, enabled)
      WHERE rule_id = $8
      RETURNING rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
      `,
      [priority, direction, match_field, match_value, lvl1, lvl2, enabled, rule_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to update rule' }, { status: 500 });
  }
}

// DELETE /api/rules?id={id}&brand=xxx - 删除规则（硬删除）
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rule_id = searchParams.get('id');
    const brand = searchParams.get('brand') || 'yufeng';
    const table = getRuleTable(brand);

    if (!table) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    const result = await pool.query(`DELETE FROM ${table} WHERE rule_id = $1 RETURNING rule_id`, [rule_id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete rule' }, { status: 500 });
  }
}
