import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// POST /api/rules/settle - 规则沉淀：人工匹配后沉淀为规则
// 功能：
// 1. 检查冲突：若同一关键词已分配给不同分类，返回冲突记录
// 2. 无冲突：直接创建规则
// 3. 有冲突：返回冲突列表，用户可选择双重匹配（添加对方单位条件）

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      brand = 'yufeng',
      bank_txn_id,      // 可选：关联的流水 ID
      lvl1,             // 一级分类
      lvl2,             // 二级分类
      match_field = 'summary',   // 匹配字段（默认摘要）
      match_value,     // 匹配关键词
      match_field2,    // 第二匹配字段（可选）
      match_value2,    // 第二匹配值（可选）
      direction = 'any', // 收/支方向
      priority,        // 可选：指定优先级
      note             // 备注
    } = body;

    // 验证必填字段
    if (!lvl1 || !match_value) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: lvl1, match_value' },
        { status: 400 }
      );
    }

    // 确定 direction：如果是收入 (in)，则检查 in_amt；否则检查 out_amt
    let actualDirection = direction;
    if (bank_txn_id) {
      const txnResult = await pool.query(
        'SELECT in_amt, out_amt FROM yufeng_ods.bank_txn WHERE id = $1',
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
    }

    // Step 1: 检查冲突（仅检查主条件）
    const conflictResult = await pool.query(`
      SELECT rule_id, priority, match_field, match_value, lvl1, lvl2, note
      FROM yufeng_cfg.bank_rule_map
      WHERE enabled = true
        AND match_field = $1
        AND match_value = $2
        AND NOT (lvl1 = $3 AND COALESCE(lvl2, '') = COALESCE($4, ''))
    `, [match_field, match_value, lvl1, lvl2 || null]);

    // 如果存在冲突
    if (conflictResult.rows.length > 0) {
      return NextResponse.json({
        success: false,
        code: 'CONFLICT_DETECTED',
        message: '检测到冲突：同一关键词已分配给其他分类',
        conflicts: conflictResult.rows.map((r: any) => ({
          rule_id: r.rule_id,
          priority: r.priority,
          match_field: r.match_field,
          match_value: r.match_value,
          lvl1: r.lvl1,
          lvl2: r.lvl2,
          note: r.note
        }))
      });
    }

    // Step 2: 无冲突，插入新规则
    // 如果未指定 priority，使用最大 priority + 10
    let newPriority = priority;
    if (!newPriority) {
      const maxPriorityResult = await pool.query(
        'SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM yufeng_cfg.bank_rule_map'
      );
      newPriority = maxPriorityResult.rows[0].new_priority;
    }

    // 确定 match_field 和 match_field2
    const actualMatchField = match_field || 'summary';
    const actualMatchField2 = (match_field2 && match_value2) ? match_field2 : null;
    const actualMatchValue2 = (match_field2 && match_value2) ? match_value2 : null;

    const insertResult = await pool.query(`
      INSERT INTO yufeng_cfg.bank_rule_map
      (enabled, priority, match_field, match_type, match_value, match_field2, match_value2, direction, lvl1, lvl2, note)
      VALUES (true, $1, $2, 'contains', $3, $4, $5, $6, $7, $8, $9)
      RETURNING rule_id, priority, match_field, match_value, match_field2, match_value2, direction, lvl1, lvl2, note, created_at
    `, [
      newPriority,
      actualMatchField,
      match_value,
      actualMatchField2,
      actualMatchValue2,
      actualDirection,
      lvl1,
      lvl2 || null,
      note || `人工沉淀：${bank_txn_id ? '关联流水 ' + bank_txn_id : '直接创建'}`
    ]);

    return NextResponse.json({
      success: true,
      code: 'RULE_CREATED',
      message: '规则创建成功',
      data: insertResult.rows[0]
    });

  } catch (error: any) {
    console.error('Error in rule settle:', error);
    // 将 pg 的关键信息回传给前端，便于定位（仅本地环境使用）
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to settle rule',
        pg: {
          code: error?.code,
          message: error?.message,
          detail: error?.detail,
          hint: error?.hint,
        },
      },
      { status: 500 }
    );
  }
}
