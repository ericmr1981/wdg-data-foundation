import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

// POST /api/rules/settle-batch - 批量规则沉淀
// 功能：
// 1. 对每条记录检查冲突（仅 enabled=true）
// 2. 无冲突：直接创建单条件规则（summary contains keyword）
// 3. 有冲突：返回冲突记录，由前端汇总展示；用户确认后用对方单位作为第二条件沉淀

interface SettleItem {
  bank_txn_id: number;
  lvl1: string;
  lvl2?: string;
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

export async function POST(request: Request) {
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
    const bankTxnTable = getOdsBankTxnTable(brand);

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: items' },
        { status: 400 }
      );
    }

    const created: any[] = [];
    const conflicts: ConflictItem[] = [];

    for (const item of items) {
      const { bank_txn_id, lvl1, lvl2, keyword, counterparty_name } = item;

      // 获取流水信息确定 direction
      let actualDirection = 'any';
      const txnResult = await pool.query(
        `SELECT in_amt, out_amt FROM ${bankTxnTable} WHERE id = $1`,
        [bank_txn_id]
      );
      if (txnResult.rows.length > 0) {
        const txn = txnResult.rows[0];
        if (txn.in_amt > 0 && txn.in_amt !== null) {
          actualDirection = 'in';
        } else if (txn.out_amt > 0 && txn.out_amt !== null) {
          actualDirection = 'out';
        }
      }

      // 如果 use_dual_match 为 true，直接使用双重匹配
      if (use_dual_match && counterparty_name) {
        const newPriority = await getNewPriority(ruleTable);

        const insertResult = await pool.query(
          `
          INSERT INTO ${ruleTable}
          (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1, lvl2, note)
          VALUES (true, $1, 'summary', 'contains', $2, 'counterparty_name', $3, $4, $5, $6, $7)
          RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1, lvl2, note, created_at
          `,
          [
            newPriority,
            keyword,
            counterparty_name,
            actualDirection,
            lvl1,
            lvl2 || null,
            `UI 批量沉淀（双重匹配）: ${bank_txn_id}`
          ]
        );

        created.push(insertResult.rows[0]);
        continue;
      }

      // Step 1: 检查冲突（仅检查主条件，仅 enabled=true）
      const conflictResult = await pool.query(
        `
        SELECT rule_id, priority, match_field, match_value, lvl1, lvl2, note
        FROM ${ruleTable}
        WHERE enabled = true
          AND match_field = 'summary'
          AND match_value = $1
          AND NOT (lvl1 = $2 AND COALESCE(lvl2, '') = COALESCE($3, ''))
        `,
        [keyword, lvl1, lvl2 || null]
      );

      if (conflictResult.rows.length > 0) {
        conflicts.push({
          item,
          existing_rules: conflictResult.rows.map((r: any) => ({
            rule_id: r.rule_id,
            priority: r.priority,
            match_field: r.match_field,
            match_value: r.match_value,
            lvl1: r.lvl1,
            lvl2: r.lvl2,
            note: r.note
          }))
        });
        continue;
      }

      // Step 2: 无冲突，创建规则
      const newPriority = await getNewPriority(ruleTable);

      const insertResult = await pool.query(
        `
        INSERT INTO ${ruleTable}
        (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1, lvl2, note)
        VALUES (true, $1, 'summary', 'contains', $2, NULL, NULL, $3, $4, $5, $6)
        RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1, lvl2, note, created_at
        `,
        [
          newPriority,
          keyword,
          actualDirection,
          lvl1,
          lvl2 || null,
          `UI 批量沉淀: ${bank_txn_id}`
        ]
      );

      created.push(insertResult.rows[0]);
    }

    return NextResponse.json({
      success: true,
      created,
      conflicts
    });
  } catch (error: any) {
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
  }
}
