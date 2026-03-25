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

     // 未分类定义：classified_source='unclassified'（不再依赖 UNCLASSIFIED 字典项）
     const result = await pool.query(
       `
       SELECT
         (SELECT count(*)::bigint
          FROM ${dmSchema}.v_bank_txn_classified c
          WHERE c.classified_source = 'unclassified') as unclassified_count,

         (SELECT sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
          FROM ${dmSchema}.v_bank_txn_classified c
          INNER JOIN ${bankTxnTable} t ON c.bank_txn_id = t.id
          WHERE c.classified_source = 'unclassified') as unclassified_amt,

         (SELECT sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0))
          FROM ${bankTxnTable} t) as total_amt
       `
     );

     const row = result.rows[0] || {};
     const unclassifiedCount = parseInt(row.unclassified_count) || 0;
     const unclassifiedAmt = parseFloat(row.unclassified_amt) || 0;
     const totalAmt = parseFloat(row.total_amt) || 0;
     const unclassifiedPct = totalAmt > 0 ? Math.round(unclassifiedAmt / totalAmt * 100 * 100) / 100 : 0;

     // 查询未分类 Top 关键词
     const topKeywordsResult = await pool.query(
       `
       SELECT
         COALESCE(c.counterparty_name, '') as counterparty_name,
         COALESCE(c.summary, '') as summary,
         count(*) as txn_count,
         sum(coalesce(t.in_amt, 0) + coalesce(t.out_amt, 0)) as total_amt
       FROM ${dmSchema}.v_bank_txn_classified c
       INNER JOIN ${bankTxnTable} t ON c.bank_txn_id = t.id
       WHERE c.classified_source = 'unclassified'
       GROUP BY c.counterparty_name, c.summary
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