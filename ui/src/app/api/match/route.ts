import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getDmSchema, getCfgSchema, getOpsSchema, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

// GET /api/match?brand=xxx - 获取未分类列表
export async function GET(request: Request) {
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
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);
    let month = searchParams.get('month');
    // Accept both YYYY-MM-01 (date) and YYYY-MM (month) formats.
    // DB column is DATE (first day of month), so normalize YYYY-MM -> YYYY-MM-01.
    if (month) {
      const m = month.trim();
      if (/^\d{4}-\d{2}$/.test(m)) month = `${m}-01`;
      else if (/^\d{4}\/\d{2}$/.test(m)) month = `${m.replace('/', '-')}-01`;
      else month = m;
    }
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const schema = getDmSchema(brand);
    const odsTable = getOdsBankTxnTable(brand);

    // 直接查询 bank_txn_classified_snapshot (BASE TABLE), 避免 v_unclassified_detail 触发全量实时分类
    let query = `
      SELECT date_trunc('month', t.txn_time)::date as month,
             t.id as bank_txn_id, t.txn_time, t.counterparty_name, t.summary, t.memo,
             t.in_amt, t.out_amt, t.balance_amt, t.source_file_id,
             COALESCE(t.counterparty_name, '') || ' | ' || COALESCE(t.summary, '') || ' | ' || COALESCE(t.memo, '') as combined_text
      FROM ${odsTable} t
      JOIN ${schema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.classified_source = 'unclassified'
    `;
    const params: any[] = [];

    if (month) {
      query += " AND date_trunc('month', t.txn_time)::date = $1::date";
      params.push(month);
    }

    const sourceFileId = searchParams.get('source_file_id');
    if (sourceFileId) {
      query += ' AND t.source_file_id = $' + (params.length + 1);
      params.push(parseInt(sourceFileId));
    }

    const bankTxnId = searchParams.get('bank_txn_id');
    if (bankTxnId) {
      query += ' AND t.id = $' + (params.length + 1);
      params.push(parseInt(bankTxnId));
    }

    query += ' ORDER BY t.txn_time DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(pageSize, (page - 1) * pageSize);

    const result = await pool.query(query, params);

    // 获取总数
    let countQuery = `
      SELECT COUNT(*) as total
      FROM ${odsTable} t
      JOIN ${schema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      WHERE c.classified_source = 'unclassified'
    `;
    const countParams: any[] = [];
    if (month) {
      countQuery += " AND date_trunc('month', t.txn_time)::date = $1::date";
      countParams.push(month);
    }
    if (sourceFileId) {
      countQuery += ' AND t.source_file_id = $' + (countParams.length + 1);
      countParams.push(parseInt(sourceFileId));
    }
    if (bankTxnId) {
      countQuery += ' AND t.id = $' + (countParams.length + 1);
      countParams.push(parseInt(bankTxnId));
    }
    const countResult = await pool.query(countQuery, countParams);
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
        note: 'bank_txn_classified_snapshot not ready'
      });
    }

    console.error('Error fetching unclassified:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch unclassified' }, { status: 500 });
  }
}

// POST /api/match - 直接写入 bank_rule_map（同时写入 override 让流水立即消失）
// body: { brand, bank_txn_id, direction, lvl1_code, lvl2_code, match_field, match_value, priority?, enabled?, bank_txn? }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);

    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    const {
      bank_txn_id,
      direction,
      lvl1_code,
      lvl2_code,
      match_field,
      match_value,
      priority = 1000,
      enabled = true,
      bank_txn // 可选，包含原始流水信息用于日志
    } = body;

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      // 兼容旧版"仅 override（不沉淀规则）"请求：{ bank_txn_id, lvl1, lvl2?, note? }
      // 旧版 UI 还在用中文名称（lvl1/lvl2），这里做一次 name->code 映射并写入 override，让页面可用。
    if (bank_txn_id && !direction && !lvl1_code && (body.lvl1 || body.lvl1_name)) {
      const lvl1Name = body.lvl1 || body.lvl1_name;
      const lvl2Name = body.lvl2 || body.lvl2_name || null;
      const dmSchema = getDmSchema(brand);
      const cfgSchema = getCfgSchema(brand);

      await client.query('BEGIN');

      // lvl1_name -> lvl1_code
      const lvl1Res = await client.query(
        `SELECT lvl1_code FROM ${cfgSchema}.dim_category_lvl1 WHERE lvl1_name = $1 LIMIT 1`,
        [lvl1Name]
      );
      if (lvl1Res.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: `Invalid lvl1 name: ${lvl1Name}` }, { status: 400 });
      }
      const lvl1c = lvl1Res.rows[0].lvl1_code;

      // lvl2_name -> lvl2_code（可空）
      let lvl2c: string | null = null;
      if (lvl2Name) {
        const lvl2Res = await client.query(
          `SELECT lvl2_code FROM ${cfgSchema}.dim_category_lvl2 WHERE lvl1_code=$1 AND lvl2_name=$2 LIMIT 1`,
          [lvl1c, lvl2Name]
        );
        if (lvl2Res.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: `Invalid lvl2 name: ${lvl2Name} (lvl1=${lvl1Name})` }, { status: 400 });
        }
        lvl2c = lvl2Res.rows[0].lvl2_code;
      }

      await client.query(
        `
        INSERT INTO ${dmSchema}.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
        VALUES ($1, $2, $3, $4, 'ui')
        ON CONFLICT (bank_txn_id) DO UPDATE SET
          lvl1_code = EXCLUDED.lvl1_code,
          lvl2_code = EXCLUDED.lvl2_code,
          note = EXCLUDED.note,
          updated_at = now()
        `,
        [bank_txn_id, lvl1c, lvl2c, body.note || '人工匹配（override-only）']
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, message: 'Override saved (legacy mode)' });
    }

    // 新版：沉淀规则（必填字段校验）
    if (!bank_txn_id || !direction || !lvl1_code || !match_field || !match_value) {
      return NextResponse.json({ success: false, error: 'Missing required fields: bank_txn_id, direction, lvl1_code, match_field, match_value' }, { status: 400 });
    }

    // 校验 direction 有效值
    if (!['in', 'out'].includes(direction)) {
      return NextResponse.json({ success: false, error: 'Invalid direction: must be in or out' }, { status: 400 });
    }

    // 校验 match_field 有效值
    const validMatchFields = ['summary', 'memo', 'purpose', 'counterparty_name'];
    if (!validMatchFields.includes(match_field)) {
      return NextResponse.json({ success: false, error: `Invalid match_field: must be one of ${validMatchFields.join(', ')}` }, { status: 400 });
    }

    const dmSchema = getDmSchema(brand);
    const cfgSchema = getCfgSchema(brand);
    const opsSchema = getOpsSchema(brand);

    // 自动推断 match_type: summary/memo/purpose = contains; counterparty_name = exact
    const matchType = match_field === 'counterparty_name' ? 'exact' : 'contains';

    await client.query('BEGIN');

    // 1. 写入 bank_rule_map（新规则）
    await client.query(
      `
      INSERT INTO ${cfgSchema}.bank_rule_map (
        enabled, priority, match_field, match_type, match_value,
        direction, lvl1, lvl2, note, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ui')
      `,
      [enabled, priority, match_field, matchType, match_value, direction, lvl1_code, lvl2_code || null, `Created from match page - txn: ${bank_txn_id}`]
    );

    // 2. 写入 bank_txn_override（让该流水立即从待分类列表消失）
    await client.query(
      `
      INSERT INTO ${dmSchema}.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
      VALUES ($1, $2, $3, $4, 'ui')
      ON CONFLICT (bank_txn_id) DO UPDATE SET
        lvl1_code = EXCLUDED.lvl1_code,
        lvl2_code = EXCLUDED.lvl2_code,
        note = EXCLUDED.note,
        updated_at = now()
      `,
      [bank_txn_id, lvl1_code, lvl2_code || null, `Rule: ${match_field} ${matchType} ${match_value}`]
    );

    // 3. 写入审计日志
    await client.query(
      `
      INSERT INTO ${opsSchema}.unclassified_resolution_log (
        bank_txn_id, month, direction, lvl1_code, lvl2_code,
        match_field, match_value, priority, enabled,
        action_type, resolution_mode,
        original_summary, original_memo, original_purpose, original_counterparty,
        original_in_amt, original_out_amt, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'ui')
      `,
      [
        bank_txn_id,
        bank_txn?.month || null,
        direction,
        lvl1_code,
        lvl2_code || null,
        match_field,
        match_value,
        priority,
        enabled,
        'manual_resolve',
        'rule_deposit',
        bank_txn?.summary || null,
        bank_txn?.memo || null,
        bank_txn?.purpose || null,
        bank_txn?.counterparty_name || null,
        bank_txn?.in_amt || null,
        bank_txn?.out_amt || null
      ]
    );

    await client.query('COMMIT');

    return NextResponse.json({ success: true, message: 'Rule created and txn resolved' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('Error creating rule from match:', error);
      return NextResponse.json({ success: false, error: 'Failed to create rule' }, { status: 500 });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error in /api/match POST:', error);
    return NextResponse.json({ success: false, error: 'Failed to create rule' }, { status: 500 });
  }
}

// PUT /api/match - 批量写入 bank_rule_map（同时写入 override 让流水立即消失）
// body: { brand, bank_txn_ids, direction, lvl1_code, lvl2_code, match_field, match_value, priority?, enabled?, bank_txns? }
export async function PUT(request: Request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    const {
      bank_txn_ids,
      direction,
      lvl1_code,
      lvl2_code,
      match_field,
      match_value,
      priority = 1000,
      enabled = true,
      bank_txns // 可选，包含原始流水信息数组用于日志
    } = body;

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    // 必填字段校验
    if (!bank_txn_ids || !Array.isArray(bank_txn_ids) || bank_txn_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing required field: bank_txn_ids must be non-empty array' }, { status: 400 });
    }

    // 兼容旧版"批量 override-only"：{ bank_txn_ids, lvl1, lvl2?, note? }
    if (!direction && !lvl1_code && (body.lvl1 || body.lvl1_name)) {
      const lvl1Name = body.lvl1 || body.lvl1_name;
      const lvl2Name = body.lvl2 || body.lvl2_name || null;
      const dmSchema = getDmSchema(brand);
      const cfgSchema = getCfgSchema(brand);

      await client.query('BEGIN');

      const lvl1Res = await client.query(
        `SELECT lvl1_code FROM ${cfgSchema}.dim_category_lvl1 WHERE lvl1_name = $1 LIMIT 1`,
        [lvl1Name]
      );
      if (lvl1Res.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ success: false, error: `Invalid lvl1 name: ${lvl1Name}` }, { status: 400 });
      }
      const lvl1c = lvl1Res.rows[0].lvl1_code;

      let lvl2c: string | null = null;
      if (lvl2Name) {
        const lvl2Res = await client.query(
          `SELECT lvl2_code FROM ${cfgSchema}.dim_category_lvl2 WHERE lvl1_code=$1 AND lvl2_name=$2 LIMIT 1`,
          [lvl1c, lvl2Name]
        );
        if (lvl2Res.rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ success: false, error: `Invalid lvl2 name: ${lvl2Name} (lvl1=${lvl1Name})` }, { status: 400 });
        }
        lvl2c = lvl2Res.rows[0].lvl2_code;
      }

      for (const bank_txn_id of bank_txn_ids) {
        await client.query(
          `
          INSERT INTO ${dmSchema}.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
          VALUES ($1, $2, $3, $4, 'ui')
          ON CONFLICT (bank_txn_id) DO UPDATE SET
            lvl1_code = EXCLUDED.lvl1_code,
            lvl2_code = EXCLUDED.lvl2_code,
            note = EXCLUDED.note,
            updated_at = now()
          `,
          [bank_txn_id, lvl1c, lvl2c, body.note || '批量人工匹配（override-only）']
        );
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true, message: `Overrides saved (legacy batch): ${bank_txn_ids.length}` });
    }

    // 新版：沉淀规则（必填字段校验）
    if (!direction || !lvl1_code || !match_field || !match_value) {
      return NextResponse.json({ success: false, error: 'Missing required fields: direction, lvl1_code, match_field, match_value' }, { status: 400 });
    }

    // 校验 direction 有效值
    if (!['in', 'out'].includes(direction)) {
      return NextResponse.json({ success: false, error: 'Invalid direction: must be in or out' }, { status: 400 });
    }

    // 校验 match_field 有效值
    const validMatchFields = ['summary', 'memo', 'purpose', 'counterparty_name'];
    if (!validMatchFields.includes(match_field)) {
      return NextResponse.json({ success: false, error: `Invalid match_field: must be one of ${validMatchFields.join(', ')}` }, { status: 400 });
    }

    const dmSchema = getDmSchema(brand);
    const cfgSchema = getCfgSchema(brand);
    const opsSchema = getOpsSchema(brand);

    // 自动推断 match_type: summary/memo/purpose = contains; counterparty_name = exact
    const matchType = match_field === 'counterparty_name' ? 'exact' : 'contains';

    await client.query('BEGIN');

    // 1. 写入 bank_rule_map（新规则）- 批量只写一条
    await client.query(
      `
      INSERT INTO ${cfgSchema}.bank_rule_map (
        enabled, priority, match_field, match_type, match_value,
        direction, lvl1, lvl2, note, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ui')
      `,
      [enabled, priority, match_field, matchType, match_value, direction, lvl1_code, lvl2_code || null, `Created from batch match - ${bank_txn_ids.length} txns`]
    );

    // 2. 批量写入 bank_txn_override（让这些流水立即从待分类列表消失）
    for (const bank_txn_id of bank_txn_ids) {
      await client.query(
        `
        INSERT INTO ${dmSchema}.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
        VALUES ($1, $2, $3, $4, 'ui')
        ON CONFLICT (bank_txn_id) DO UPDATE SET
          lvl1_code = EXCLUDED.lvl1_code,
          lvl2_code = EXCLUDED.lvl2_code,
          note = EXCLUDED.note,
          updated_at = now()
        `,
        [bank_txn_id, lvl1_code, lvl2_code || null, `Rule: ${match_field} ${matchType} ${match_value}`]
      );
    }

    // 3. 批量写入审计日志
    for (const bank_txn_id of bank_txn_ids) {
      // 找到对应的原始流水信息
      const txnInfo = bank_txns?.find((t: any) => t.bank_txn_id === bank_txn_id);
      await client.query(
        `
        INSERT INTO ${opsSchema}.unclassified_resolution_log (
          bank_txn_id, month, direction, lvl1_code, lvl2_code,
          match_field, match_value, priority, enabled,
          action_type, resolution_mode,
          original_summary, original_memo, original_purpose, original_counterparty,
          original_in_amt, original_out_amt, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'ui')
        `,
        [
          bank_txn_id,
          txnInfo?.month || null,
          direction,
          lvl1_code,
          lvl2_code || null,
          match_field,
          match_value,
          priority,
          enabled,
          'batch_resolve',
          'rule_deposit',
          txnInfo?.summary || null,
          txnInfo?.memo || null,
          txnInfo?.purpose || null,
          txnInfo?.counterparty_name || null,
          txnInfo?.in_amt || null,
          txnInfo?.out_amt || null
        ]
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({ success: true, message: `Batch rule created and ${bank_txn_ids.length} txns resolved` });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating batch rule from match:', error);
    return NextResponse.json({ success: false, error: 'Failed to create batch rule' }, { status: 500 });
  } finally {
    client.release();
  }
}
