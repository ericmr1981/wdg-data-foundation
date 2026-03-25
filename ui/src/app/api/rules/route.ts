import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, getCfgSchema, normalizeBrand } from '@/lib/brand-server';

const RESERVED_LVL1_CODES = new Set(['UNCLASSIFIED', 'OTHER_OUT']);

async function assertCategoryEnabled(cfgSchema: string, lvl1_code: string, lvl2_code?: string | null) {
  const lvl1Res = await pool.query(
    `SELECT lvl1_code, enabled FROM ${cfgSchema}.dim_category_lvl1 WHERE lvl1_code=$1 LIMIT 1`,
    [lvl1_code]
  );
  if (lvl1Res.rows.length === 0) {
    throw Object.assign(new Error(`Invalid lvl1_code: ${lvl1_code}`), { status: 400 });
  }
  if (!lvl1Res.rows[0].enabled) {
    throw Object.assign(new Error(`lvl1_code disabled: ${lvl1_code}`), { status: 400 });
  }
  if (RESERVED_LVL1_CODES.has(lvl1_code)) {
    throw Object.assign(new Error(`lvl1_code is reserved: ${lvl1_code}`), { status: 400 });
  }

  if (lvl2_code) {
    const lvl2Res = await pool.query(
      `
      SELECT lvl2_code, enabled
      FROM ${cfgSchema}.dim_category_lvl2
      WHERE lvl1_code=$1 AND lvl2_code=$2
      LIMIT 1
      `,
      [lvl1_code, lvl2_code]
    );
    if (lvl2Res.rows.length === 0) {
      throw Object.assign(new Error(`Invalid lvl2_code: ${lvl2_code} (lvl1_code=${lvl1_code})`), { status: 400 });
    }
    if (!lvl2Res.rows[0].enabled) {
      throw Object.assign(new Error(`lvl2_code disabled: ${lvl2_code} (lvl1_code=${lvl1_code})`), { status: 400 });
    }
  }
}

function assertMatchFieldAndType(match_field: string, match_type: string) {
  const validMatchFields = ['summary', 'memo', 'purpose', 'counterparty_name'];
  if (!validMatchFields.includes(match_field)) {
    throw Object.assign(new Error(`Invalid match_field: ${match_field}`), { status: 400 });
  }

  // 与当前 yufeng 分类函数 v2 的实现对齐：
  // - summary/memo/purpose: 仅支持 contains
  // - counterparty_name: 默认 exact（未来如要开放 contains，需要同步改分类函数与约束）
  if (match_field === 'counterparty_name') {
    if (match_type !== 'exact') {
      throw Object.assign(new Error('counterparty_name only supports match_type=exact'), { status: 400 });
    }
  } else {
    if (match_type !== 'contains') {
      throw Object.assign(new Error('summary/memo/purpose only supports match_type=contains'), { status: 400 });
    }
  }
}

// GET /api/rules?brand=xxx - 获取规则列表
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brandParam = searchParams.get('brand') || 'yufeng';
  const brand = normalizeBrand(brandParam);

  if (!brand) {
    return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
  }

  const ruleTable = getCfgRuleTable(brand);
  const cfgSchema = getCfgSchema(brand);

  try {
    const result = await pool.query(
      `
      SELECT
        r.rule_id, r.priority, r.direction, r.match_field, r.match_type, r.match_value,
        r.match_field2, r.match_value2,
        r.lvl1_code, r.lvl2_code, r.enabled, r.created_at,
        l1.lvl1_name,
        l2.lvl2_name
      FROM ${ruleTable} r
      LEFT JOIN ${cfgSchema}.dim_category_lvl1 l1
        ON r.lvl1_code = l1.lvl1_code
      LEFT JOIN ${cfgSchema}.dim_category_lvl2 l2
        ON r.lvl1_code = l2.lvl1_code AND r.lvl2_code = l2.lvl2_code
      ORDER BY r.priority ASC, r.rule_id ASC
      `
    );

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
    const brandParam = body.brand || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const ruleTable = getCfgRuleTable(brand);
    const cfgSchema = getCfgSchema(brand);

    const {
      priority,
      direction,
      match_field,
      match_type,
      match_value,
      match_field2,
      match_value2,
      lvl1_code,
      lvl2_code,
      enabled
    } = body;

    if (!priority || !direction || !match_field || !match_value || !lvl1_code) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const mt = match_type || (match_field === 'counterparty_name' ? 'exact' : 'contains');

    assertMatchFieldAndType(match_field, mt);

    // 双重匹配仅允许 counterparty_name exact
    const mf2 = match_field2 || null;
    const mv2 = match_value2 || null;
    if (mf2) {
      if (mf2 !== 'counterparty_name') {
        return NextResponse.json({ success: false, error: 'match_field2 only supports counterparty_name' }, { status: 400 });
      }
      if (!mv2) {
        return NextResponse.json({ success: false, error: 'match_value2 is required when match_field2 is set' }, { status: 400 });
      }
      if (mt === 'exact' && match_field === 'counterparty_name') {
        // 主条件已是对方单位精确匹配时，双重匹配无意义
      }
    }

    await assertCategoryEnabled(cfgSchema, lvl1_code, lvl2_code || null);

    const result = await pool.query(
      `
      INSERT INTO ${ruleTable} (
        priority, direction,
        match_field, match_type, match_value,
        match_field2, match_value2,
        lvl1_code, lvl2_code, enabled
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING rule_id, priority, direction, match_field, match_type, match_value, match_field2, match_value2, lvl1_code, lvl2_code, enabled, created_at
      `,
      [
        priority,
        direction,
        match_field,
        mt,
        match_value,
        mf2,
        mv2,
        lvl1_code,
        lvl2_code || null,
        enabled !== false
      ]
    );

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    const status = error?.status || 500;
    if (status === 400) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('Error creating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to create rule' }, { status: 500 });
  }
}

// PUT /api/rules - 更新规则（body.brand 可选，默认 yufeng）
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const brandParam = body.brand || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const ruleTable = getCfgRuleTable(brand);
    const cfgSchema = getCfgSchema(brand);

    const {
      rule_id,
      priority,
      direction,
      match_field,
      match_type,
      match_value,
      match_field2,
      match_value2,
      lvl1_code,
      lvl2_code,
      enabled
    } = body;

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    // 如果用户在编辑时改了 match_field/match_type，则进行约束校验；否则允许只改 enabled/priority 等
    if (match_field || match_type) {
      // match_field 未提供但 match_type 提供时：先查旧值
      let mf = match_field;
      let mt = match_type;
      if (!mf || !mt) {
        const oldRes = await pool.query(
          `SELECT match_field, match_type FROM ${ruleTable} WHERE rule_id=$1 LIMIT 1`,
          [rule_id]
        );
        if (oldRes.rows.length === 0) {
          return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
        }
        mf = mf || oldRes.rows[0].match_field;
        mt = mt || oldRes.rows[0].match_type;
      }
      assertMatchFieldAndType(mf, mt);
    }

    // 双重匹配仅允许 counterparty_name exact
    if (match_field2) {
      if (match_field2 !== 'counterparty_name') {
        return NextResponse.json({ success: false, error: 'match_field2 only supports counterparty_name' }, { status: 400 });
      }
      if (!match_value2) {
        return NextResponse.json({ success: false, error: 'match_value2 is required when match_field2 is set' }, { status: 400 });
      }
    }

    // 若更新了分类，则校验字典表（且禁止 reserved）
    if (lvl1_code) {
      await assertCategoryEnabled(cfgSchema, lvl1_code, lvl2_code || null);
    }

    const result = await pool.query(
      `
      UPDATE ${ruleTable}
      SET priority = COALESCE($1, priority),
          direction = COALESCE($2, direction),
          match_field = COALESCE($3, match_field),
          match_type = COALESCE($4, match_type),
          match_value = COALESCE($5, match_value),
          match_field2 = $6,
          match_value2 = $7,
          lvl1_code = COALESCE($8, lvl1_code),
          lvl2_code = $9,
          enabled = COALESCE($10, enabled),
          updated_at = now()
      WHERE rule_id = $11
      RETURNING rule_id, priority, direction, match_field, match_type, match_value, match_field2, match_value2, lvl1_code, lvl2_code, enabled, created_at
      `,
      [
        priority,
        direction,
        match_field,
        match_type,
        match_value,
        match_field2 || null,
        match_value2 || null,
        lvl1_code,
        lvl2_code ?? null,
        enabled,
        rule_id
      ]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    const status = error?.status || 500;
    if (status === 400) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('Error updating rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to update rule' }, { status: 500 });
  }
}

// DELETE /api/rules?id={id}&brand=xxx - 删除规则（硬删除）
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rule_id = searchParams.get('id');
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!rule_id) {
      return NextResponse.json({ success: false, error: 'Missing rule_id' }, { status: 400 });
    }

    const ruleTable = getCfgRuleTable(brand);

    const result = await pool.query(`DELETE FROM ${ruleTable} WHERE rule_id = $1 RETURNING rule_id`, [rule_id]);

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    console.error('Error deleting rule:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete rule' }, { status: 500 });
  }
}
