import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

// GET /api/pipeline/kpi?brand=xxx
// 返回未分类统计（软阀门 KPI）
// 数据源: bank_txn_classified_snapshot (预分类快照 BASE TABLE, 避免触发视图级全量分类)
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const dmSchema = getDmSchema(brand);

    // 使用 bank_txn_classified_snapshot (BASE TABLE, 不会触发全量分类)
    const statsResult = await pool.query(
      `
      SELECT
        c.classified_source,
        count(*) AS txn_count,
        COALESCE(SUM(COALESCE(t.in_amt, 0) + COALESCE(t.out_amt, 0)), 0) AS total_amt
      FROM ${dmSchema}.bank_txn_classified_snapshot c
      JOIN ${brand}_ods.bank_txn t ON t.id = c.bank_txn_id
      GROUP BY c.classified_source
      `
    );

    let totalAmt = 0;
    let totalCount = 0;
    let classifiedAmt = 0;
    let unclassifiedCount = 0;
    let unclassifiedAmt = 0;

    for (const row of statsResult.rows as { classified_source: string; txn_count: string; total_amt: string }[]) {
      const amt = parseFloat(row.total_amt) || 0;
      const cnt = parseInt(row.txn_count) || 0;
      totalAmt += amt;
      totalCount += cnt;
      if (row.classified_source === 'unclassified') {
        unclassifiedCount = cnt;
        unclassifiedAmt = amt;
      } else {
        classifiedAmt += amt;
      }
    }

    const unclassifiedPct = totalAmt > 0 ? Math.round((unclassifiedAmt / totalAmt) * 10000) / 100 : 0;

    // Top unclassified keywords
    const topResult = await pool.query(
      `
      SELECT
        CASE
          WHEN t.counterparty_name IS NOT NULL AND t.counterparty_name != '' THEN t.counterparty_name
          WHEN t.purpose IS NOT NULL AND t.purpose != '' AND t.purpose != 'NaN' THEN t.purpose
          WHEN t.summary IS NOT NULL AND t.summary != '' THEN t.summary
          ELSE '（未知名）'
        END AS keyword,
        count(*) AS hit_count
      FROM ${dmSchema}.bank_txn_classified_snapshot c
      JOIN ${brand}_ods.bank_txn t ON t.id = c.bank_txn_id
      WHERE c.classified_source = 'unclassified'
      GROUP BY 1
      ORDER BY count(*) DESC
      LIMIT 20
      `
    );

    const topKeywords = (topResult.rows as { keyword: string; hit_count: number }[])
      .map(r => ({ keyword: r.keyword, count: parseInt(String(r.hit_count)) }));

    return NextResponse.json({
      success: true,
      data: {
        unclassified_count: unclassifiedCount,
        unclassified_amt: unclassifiedAmt,
        total_amt: totalAmt,
        unclassified_pct: unclassifiedPct,
        top_keywords: topKeywords
      }
    });
  } catch (error: any) {
    console.error('Error fetching pipeline KPI:', error);

    if (error.code === '42P01') {
      return NextResponse.json({
        success: true,
        data: {
          unclassified_count: 0,
          unclassified_amt: 0,
          total_amt: 0,
          unclassified_pct: 0,
          top_keywords: []
        },
        note: 'snapshot not ready'
      });
    }

    return NextResponse.json({ success: false, error: 'Failed to fetch pipeline KPI' }, { status: 500 });
  }
}
