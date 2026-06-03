import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, getCfgSchema, getDmSchema, getOpsSchema, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

// POST /api/rules/settle-batch - 批量规则沉淀
// 前端传 lvl1/lvl2（中文名），后端映射到 code 后写入 bank_rule_map（列名 lvl1/lvl2）
// 同时写 override 让流水立即从待分类列表消失，并写审计日志

interface SettleItem {
  bank_txn_id: number;
  lvl1: string; // lvl1_name (legacy)
  lvl2?: string; // lvl2_name (legacy)
  keyword: string;
  counterparty_name?: string;
}

interface ConflictItem {
  item: SettleItem;
  existing_rules: Array<{
    rule_id: number;
    priority: number;
    match_field: string;
    match_value: string;
    lvl1: string;
    lvl2: string | null;
    note: string | null;
  }>;
}

async function getNewPriority(ruleTable: string): Promise<number> {
  const result = await pool.query(
    `SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM ${ruleTable}`
  );
  return result.rows[0].new_priority;
}

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
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { brand: brandParam = 'yufeng', items, use_dual_match = false } = body as {
      brand?: string;
      items: SettleItem[];
      use_dual_match?: boolean;
    };

    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const ruleTable = getCfgRuleTable(brand);
    const cfgSchema = getCfgSchema(brand);
    const dmSchema = getDmSchema(brand);
    const opsSchema = getOpsSchema(brand);
    const bankTxnTable = getOdsBankTxnTable(brand);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: items' },
        { status: 400 }
      );
    }

    const created: any[] = [];
    const conflicts: ConflictItem[] = [];
    const sourceFileIds = new Set<number>();

    await client.query('BEGIN');

    for (const item of items) {
      const { bank_txn_id, lvl1, lvl2, keyword, counterparty_name } = item;

      const { lvl1_code, lvl2_code } = await mapNameToCode(cfgSchema, lvl1, lvl2 || null);

      // 获取流水信息确定 direction 和原始数据
      let actualDirection = 'out';
      const txnResult = await client.query(
        `SELECT date_trunc('month', txn_time)::date as month, source_file_id,
                in_amt, out_amt, summary, memo, purpose, counterparty_name
         FROM ${bankTxnTable} WHERE id = $1`,
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
      const txn = txnResult.rows.length > 0 ? txnResult.rows[0] : null;
      if (txn?.source_file_id) {
        sourceFileIds.add(Number(txn.source_file_id));
      }

      // 智能推断 match_type: summary/memo/purpose = contains; counterparty_name = exact
      // 批量沉淀默认使用 summary
      const matchField = 'summary';
      const matchType = 'contains';

      // 如果 use_dual_match 为 true，直接使用双重匹配
      if (use_dual_match && counterparty_name) {
        const newPriorityResult = await client.query(
          `SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM ${ruleTable}`
        );
        const newPriority = newPriorityResult.rows[0].new_priority;

        const insertResult = await client.query(
          `
          INSERT INTO ${ruleTable}
          (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note)
          VALUES (true, $1, 'summary', 'contains', $2, 'counterparty_name', $3, $4, $5, $6, $7)
          RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note, created_at
          `,
          [
            newPriority,
            keyword,
            counterparty_name,
            actualDirection,
            lvl1_code,
            lvl2_code,
            `UI 批量沉淀（双重匹配）: ${bank_txn_id}`
          ]
        );

        const createdRule = insertResult.rows[0];
        created.push(createdRule);

        // 写入 override
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
          [bank_txn_id, lvl1_code, lvl2_code, `批量规则沉淀（双重匹配）`]
        );

        // 写入审计日志
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
            matchField,
            keyword,
            newPriority,
            true,
            'batch_resolve',
            'rule_deposit',
            txn?.summary || null,
            txn?.memo || null,
            txn?.purpose || null,
            txn?.counterparty_name || null,
            txn?.in_amt || null,
            txn?.out_amt || null
          ]
        );

        continue;
      }

      // Step 1: 检查冲突（仅检查主条件，仅 enabled=true）- 使用 lvl1/lvl2 列名
      const conflictResult = await client.query(
        `
        SELECT rule_id, priority, match_field, match_value, lvl1_code, lvl2_code, note
        FROM ${ruleTable}
        WHERE enabled = true
          AND match_field = 'summary'
          AND match_value = $1
          AND NOT (lvl1_code = $2 AND COALESCE(lvl2_code, '') = COALESCE($3, ''))
        `,
        [keyword, lvl1_code, lvl2_code]
      );

      if (conflictResult.rows.length > 0) {
        conflicts.push({
          item,
          existing_rules: conflictResult.rows.map((r: any) => ({
            rule_id: r.rule_id,
            priority: r.priority,
            match_field: r.match_field,
            match_value: r.match_value,
            lvl1: r.lvl1_code,
            lvl2: r.lvl2_code,
            note: r.note
          }))
        });
        continue;
      }

      // Step 2: 无冲突，创建规则
      const newPriorityResult = await client.query(
        `SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM ${ruleTable}`
      );
      const newPriority = newPriorityResult.rows[0].new_priority;

      const insertResult = await client.query(
        `
        INSERT INTO ${ruleTable}
        (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note)
        VALUES (true, $1, 'summary', 'contains', $2, NULL, NULL, $3, $4, $5, $6)
        RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1_code, lvl2_code, note, created_at
        `,
        [
          newPriority,
          keyword,
          actualDirection,
          lvl1_code,
          lvl2_code,
          `UI 批量沉淀: ${bank_txn_id}`
        ]
      );

      const createdRule = insertResult.rows[0];
      created.push(createdRule);

      // 写入 override
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
        [bank_txn_id, lvl1_code, lvl2_code, `批量规则沉淀`]
      );

      // 写入审计日志
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
          matchField,
          keyword,
          newPriority,
          true,
          'batch_resolve',
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

    // L2 snapshot：批量规则写入后，刷新涉及文件的 snapshot（best-effort，不阻断返回）
    try {
      const ids = Array.from(sourceFileIds.values());
      if (ids.length === 0) {
        // 没拿到 source_file_id（少见），退化为全量刷新
        await pool.query(`SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot(NULL)`);
      } else {
        for (const fileId of ids) {
          await pool.query(`SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot($1)`, [fileId]);
        }
      }
    } catch (e) {
      console.warn('WARN: refresh snapshot skipped after batch settle:', e);
    }

    return NextResponse.json({
      success: true,
      created,
      conflicts
    });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => {});
    const status = error?.status || 500;
    if (status === 400) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }

    console.error('Error in batch settle:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to settle batch rules',
        pg: {
          code: error?.code,
          message: error?.message,
          detail: error?.detail,
          hint: error?.hint
        }
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
