import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, getCfgSchema, getDmSchema, getOpsSchema, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

// POST /api/rules/settle - 规则沉淀：人工匹配后沉淀为规则
// 前端传 lvl1/lvl2（中文名），后端映射到 code 后写入 bank_rule_map（列名 lvl1/lvl2）
// 同时写 override 让流水立即从待分类列表消失，并写审计日志

async function mapNameToCode(cfgSchema: string, lvl1Name: string, lvl2Name?: string | null) {
  const lvl1Res = await pool.query(
    `SELECT lvl1_code FROM ${cfgSchema}.dim_category_lvl1 WHERE lvl1_name = $1 LIMIT 1`,
    [lvl1Name]
  );
  if (lvl1Res.rows.length === 0) {
    throw Object.assign(new Error(`Invalid lvl1 name: ${lvl1Name}`), { status: 400 });
  }
  const lvl1_code: string = lvl1Res.rows[0].lvl1_code;

  let lvl2_code: string | null = null;
  if (lvl2Name) {
    const lvl2Res = await pool.query(
      `SELECT lvl2_code FROM ${cfgSchema}.dim_category_lvl2 WHERE lvl1_code=$1 AND lvl2_name=$2 LIMIT 1`,
      [lvl1_code, lvl2Name]
    );
    if (lvl2Res.rows.length === 0) {
      throw Object.assign(new Error(`Invalid lvl2 name: ${lvl2Name} (lvl1=${lvl1Name})`), { status: 400 });
    }
    lvl2_code = lvl2Res.rows[0].lvl2_code;
  }

  return { lvl1_code, lvl2_code };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      brand: brandParam = 'yufeng',
      bank_txn_id, // 可选：关联的流水 ID
      lvl1, // 一级分类（中文名）
      lvl2, // 二级分类（中文名，可空）
      match_field = 'summary',
      match_value,
      match_field2,
      match_value2,
      direction = 'out',
      priority,
      note
    } = body;

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const ruleTable = getCfgRuleTable(brand);
    const cfgSchema = getCfgSchema(brand);
    const bankTxnTable = getOdsBankTxnTable(brand);

    if (!lvl1 || !match_value) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: lvl1, match_value' },
        { status: 400 }
      );
    }

    const { lvl1_code, lvl2_code } = await mapNameToCode(cfgSchema, lvl1, lvl2 || null);

    // 确定 direction
    let actualDirection = direction;
    if (bank_txn_id) {
      const txnResult = await pool.query(
        `SELECT in_amt, out_amt FROM ${bankTxnTable} WHERE id = $1`,
        [bank_txn_id]
      );
      if (txnResult.rows.length > 0) {
        const txn = txnResult.rows[0];
        if (txn.in_amt !== null && txn.in_amt > 0) {
          actualDirection = 'in';
        } else if (txn.out_amt !== null && txn.out_amt > 0) {
          actualDirection = 'out';
        }
      }
    }
    // direction 必须有 'in'/'out'('any' 会导致 bank_rule_map CHECK 约束失败)
    if (actualDirection !== 'in' && actualDirection !== 'out') {
      return NextResponse.json({ success: false, error: `Invalid direction: ${actualDirection}` }, { status: 400 });
    }

    // 冲突检查（主条件）- 使用 lvl1/lvl2 列名
    const conflictResult = await pool.query(
      `
      SELECT rule_id, priority, match_field, match_value, lvl1_code, lvl2_code, note
      FROM ${ruleTable}
      WHERE enabled = true
        AND match_field = $1
        AND match_value = $2
        AND direction = $3
        AND NOT (lvl1_code = $4 AND COALESCE(lvl2_code, '') = COALESCE($5, ''))
      `,
      [match_field, match_value, actualDirection, lvl1_code, lvl2_code]
    );

    if (conflictResult.rows.length > 0) {
      return NextResponse.json({
        success: false,
        code: 'CONFLICT_DETECTED',
        message: '检测到冲突：同一关键词已分配给其他分类',
        conflicts: conflictResult.rows
      });
    }

    // priority
    let newPriority = priority;
    if (!newPriority) {
      const maxPriorityResult = await pool.query(
        `SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM ${ruleTable}`
      );
      newPriority = maxPriorityResult.rows[0].new_priority;
    }

    const actualMatchField2 = match_field2 && match_value2 ? match_field2 : null;
    const actualMatchValue2 = match_field2 && match_value2 ? match_value2 : null;

    // 智能推断 match_type: counterparty_name = exact, others = contains
    const matchType = match_field === 'counterparty_name' ? 'exact' : 'contains';

    const dmSchema = getDmSchema(brand);
    const opsSchema = getOpsSchema(brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. 写入 bank_rule_map（使用 lvl1/lvl2 列名，但写入 code 值）
      const insertResult = await client.query(
        `
        INSERT INTO ${ruleTable}
        (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note)
        VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note, created_at
        `,
        [
          newPriority,
          match_field,
          matchType,
          match_value,
          actualMatchField2,
          actualMatchValue2,
          actualDirection,
          lvl1_code,
          lvl2_code,
          note || `人工沉淀：${bank_txn_id ? '关联流水 ' + bank_txn_id : '直接创建'}`
        ]
      );

      const createdRule = insertResult.rows[0];

      // 2. 如果有 bank_txn_id，写入 override 让流水从待分类列表消失
      if (bank_txn_id) {
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
          [bank_txn_id, lvl1_code, lvl2_code, `规则沉淀: ${match_field} ${matchType} ${match_value}`]
        );
      }

      // 3. 写入审计日志
      if (bank_txn_id) {
        // 获取原始流水信息
        const txnResult = await client.query(
          `SELECT date_trunc('month', txn_time)::date as month, source_file_id,
                  summary, memo, purpose, counterparty_name, in_amt, out_amt
           FROM ${bankTxnTable} WHERE id = $1`,
          [bank_txn_id]
        );
        const txn = txnResult.rows.length > 0 ? txnResult.rows[0] : null;

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
            txn?.month || null,
            actualDirection,
            lvl1_code,
            lvl2_code || null,
            match_field,
            match_value,
            newPriority,
            true,
            'manual_resolve',
            'rule_deposit',
            txn?.summary || null,
            txn?.memo || null,
            txn?.purpose || null,
            txn?.counterparty_name || null,
            txn?.in_amt || null,
            txn?.out_amt || null
          ]
        );
      }

      await client.query('COMMIT');

      // L2 snapshot：规则写入后，刷新该流水所属文件的 snapshot（best-effort，不阻断返回）
      try {
        if (bank_txn_id) {
          const fileRes = await pool.query(
            `SELECT source_file_id FROM ${bankTxnTable} WHERE id = $1`,
            [bank_txn_id]
          );
          const sourceFileId = fileRes.rows?.[0]?.source_file_id;
          if (sourceFileId) {
            await pool.query(`SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot($1)`, [sourceFileId]);
          } else {
            // 没有 source_file_id（少见），退化为全量刷新
            await pool.query(`SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot(NULL)`);
          }
        }
      } catch (e) {
        console.warn('WARN: refresh snapshot skipped after rule settle:', e);
      }

      return NextResponse.json({
        success: true,
        code: 'RULE_CREATED',
        message: '规则创建成功',
        data: createdRule
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

    console.error('Error in rule settle:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to settle rule',
        pg: {
          code: error?.code,
          message: error?.message,
          detail: error?.detail,
          hint: error?.hint
        }
      },
      { status: 500 }
    );
  }
}
