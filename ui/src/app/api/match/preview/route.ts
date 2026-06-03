import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

// GET /api/match/preview?brand=xxx&match_value=美团
// 用途: 规则创建/编辑时，预览指定 match_value 大致会命中哪些历史流水
// 注意: 这是规则管理工具(非财务数据分析)，需要模拟分类引擎的 ILIKE 匹配来展示预估命中数，
//       因此直接扫描原始 bank_txn，属管理操作。
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);
    const matchValue = searchParams.get('match_value');

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!matchValue) {
      return NextResponse.json({ success: false, error: 'Missing match_value' }, { status: 400 });
    }

    if (matchValue.length < 3) {
      return NextResponse.json({
        success: false,
        error: 'match_value must be at least 3 characters for counterparty_name contains rules'
      }, { status: 400 });
    }

    const dmSchema = getDmSchema(brand);
    const bankTxnTable = getOdsBankTxnTable(brand);

    // 查询命中的流水 — 模拟规则引擎的 ILIKE 匹配(管理预览用途)
    const result = await pool.query(
      `
      SELECT
        c.lvl1_code as lvl1,
        c.lvl2_code as lvl2,
        COALESCE(t.in_amt, 0) + COALESCE(t.out_amt, 0) as amt
      FROM ${dmSchema}.v_bank_txn_classified c
      INNER JOIN ${bankTxnTable} t ON c.bank_txn_id = t.id
      WHERE t.counterparty_name ILIKE '%' || $1 || '%'
         OR t.summary ILIKE '%' || $1 || '%'
         OR t.memo ILIKE '%' || $1 || '%'
         OR t.purpose ILIKE '%' || $1 || '%'
      `,
      [matchValue]
    );

    const hitCount = result.rows.length;
    const totalAmt = result.rows.reduce((sum, row) => sum + parseFloat(row.amt || '0'), 0);

    const lvl1Count: Record<string, number> = {};
    const lvl2Count: Record<string, number> = {};

    for (const row of result.rows) {
      const lvl1 = row.lvl1 || '未分类';
      const lvl2 = row.lvl2;

      lvl1Count[lvl1] = (lvl1Count[lvl1] || 0) + 1;

      if (lvl2) {
        lvl2Count[lvl2] = (lvl2Count[lvl2] || 0) + 1;
      }
    }

    const primaryLvl1 = Object.entries(lvl1Count)
      .filter(([lvl]) => lvl !== '未分类')
      .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    const primaryLvl2 = Object.entries(lvl2Count)
      .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    return NextResponse.json({
      success: true,
      data: {
        match_value: matchValue,
        hit_count: hitCount,
        total_amt: Math.round(totalAmt * 100) / 100,
        primary_lvl1: primaryLvl1,
        primary_lvl2: primaryLvl2,
        lvl1_distribution: lvl1Count,
        lvl2_distribution: lvl2Count
      }
    });
  } catch (error: any) {
    console.error('Error previewing match value:', error);

    if (error.code === '42P01') {
      return NextResponse.json({
        success: true,
        data: {
          match_value: '',
          hit_count: 0,
          total_amt: 0,
          primary_lvl1: null,
          primary_lvl2: null,
          lvl1_distribution: {},
          lvl2_distribution: {}
        },
        note: 'v_bank_txn_classified not ready'
      });
    }

    return NextResponse.json({ success: false, error: 'Failed to preview match value' }, { status: 500 });
  }
}
