import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// GET /api/rules - 获取规则列表
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brand = searchParams.get('brand') || 'yufeng';

  try {
    let result;
    if (brand === 'yufeng') {
      result = await pool.query(`
        SELECT rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
        FROM yufeng_cfg.bank_rule_map
        ORDER BY priority ASC, rule_id ASC
      `);
    } else if (brand === 'bonjur') {
      // Bonjur 暂时返回空
      return NextResponse.json({ success: true, data: [] });
    } else {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching rules:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch rules' }, { status: 500 });
  }
}

// POST /api/rules - 创建规则
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { priority, direction, match_field, match_value, lvl1, lvl2, enabled } = body;

    if (!priority || !direction || !match_field || !match_value || !lvl1) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const result = await pool.query(`
      INSERT INTO yufeng_cfg.bank_rule_map (priority, direction, match_field, match_value, lvl1, lvl2, enabled)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
    `, [priority, direction, match_field, match_value, lvl1, lvl2 || null, enabled !== false]);

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to create rule' }, { status: 500 });
  }
}

// PUT /api/rules - 更新规则
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled } = body;

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    const result = await pool.query(`
      UPDATE yufeng_cfg.bank_rule_map
      SET priority = COALESCE($1, priority),
          direction = COALESCE($2, direction),
          match_field = COALESCE($3, match_field),
          match_value = COALESCE($4, match_value),
          lvl1 = COALESCE($5, lvl1),
          lvl2 = $6,
          enabled = COALESCE($7, enabled)
      WHERE rule_id = $8
      RETURNING rule_id, priority, direction, match_field, match_value, lvl1, lvl2, enabled, created_at
    `, [priority, direction, match_field, match_value, lvl1, lvl2, enabled, rule_id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error updating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to update rule' }, { status: 500 });
  }
}

// DELETE /api/rules?id={id} - 删除规则
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rule_id = searchParams.get('id');

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    // 软删除：设置 enabled = false
    await pool.query(`
      UPDATE yufeng_cfg.bank_rule_map
      SET enabled = false
      WHERE rule_id = $1
    `, [rule_id]);

    return NextResponse.json({ success: true, message: 'Rule disabled' });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete rule' }, { status: 500 });
  }
}
