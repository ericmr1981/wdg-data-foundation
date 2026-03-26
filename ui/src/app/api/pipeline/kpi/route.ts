// =============================================================================
 // api/pipeline/kpi/route.ts
 // 用途：软阀门 KPI - 未分类统计
 // 作者：Claude Code
 // =============================================================================

 import { NextResponse } from 'next/server';
 import pool from '@/lib/db';
 import { getDmSchema, getOdsBankTxnTable, normalizeBrand } from '@/lib/brand-server';

 // GET /api/pipeline/kpi?brand=xxx
 // 返回未分类统计（软阀门 KPI）
 export async function GET(request: Request) {
   try {
     const { searchParams } = new URL(request.url);
     const brandParam = searchParams.get('brand') || 'yufeng';
     const brand = normalizeBrand(brandParam);

     if (!brand) {
       return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
     }

     const dmSchema = getDmSchema(brand);
     const bankTxnTable = getOdsBankTxnTable(brand);

     // 注意：v_bank_txn_classified 可能很重（全量分类），在 VPS 上会导致接口卡死。
     // KPI 改为基于 v_unclassified_detail（只包含未分类明细）做聚合，性能更稳定。
     const aggResult = await pool.query(
       `
       SELECT
         count(*)::bigint as unclassified_count,
         sum(coalesce(in_amt, 0) + coalesce(out_amt, 0)) as unclassified_amt
       FROM ${dmSchema}.v_unclassified_detail
       `
     );

     const totalResult = await pool.query(
       `
       SELECT sum(coalesce(in_amt, 0) + coalesce(out_amt, 0)) as total_amt
       FROM ${bankTxnTable}
       `
     );

     const aggRow = aggResult.rows[0] || {};
     const totalRow = totalResult.rows[0] || {};

     const unclassifiedCount = parseInt(aggRow.unclassified_count) || 0;
     const unclassifiedAmt = parseFloat(aggRow.unclassified_amt) || 0;
     const totalAmt = parseFloat(totalRow.total_amt) || 0;
     const unclassifiedPct = totalAmt > 0 ? Math.round((unclassifiedAmt / totalAmt) * 100 * 100) / 100 : 0;

     // 查询未分类 Top 关键词（直接从未分类明细聚合）
     const topKeywordsResult = await pool.query(
       `
       SELECT
         COALESCE(counterparty_name, '') as counterparty_name,
         COALESCE(summary, '') as summary,
         count(*) as txn_count,
         sum(coalesce(in_amt, 0) + coalesce(out_amt, 0)) as total_amt
       FROM ${dmSchema}.v_unclassified_detail
       GROUP BY counterparty_name, summary
       ORDER BY txn_count desc
       LIMIT 10
       `
     );

     const topKeywords = topKeywordsResult.rows.map((r: any) => ({
       counterparty_name: r.counterparty_name,
       summary: r.summary,
       txn_count: parseInt(r.txn_count),
       total_amt: parseFloat(r.total_amt) || 0
     }));

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

     // 如果是视图不存在，返回空数据
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
         note: 'v_bank_txn_classified not ready'
       });
     }

     return NextResponse.json({ success: false, error: 'Failed to fetch pipeline KPI' }, { status: 500 });
   }
 }