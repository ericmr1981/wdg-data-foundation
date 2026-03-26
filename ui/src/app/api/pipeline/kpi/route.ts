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

     // 注意：v_bank_txn_classified / v_unclassified_detail 可能非常重（会触发全量分类），在 VPS 上会导致接口卡死。
     // KPI 走“快速路径”：基于 v_coverage_by_file 做聚合（按文件已聚合，行数极少）。
     const coverageAgg = await pool.query(
       `
       SELECT
         COALESCE(sum(unclassified_rows), 0)::bigint as unclassified_count,
         (COALESCE(sum(unclassified_in_amt), 0) + COALESCE(sum(unclassified_out_amt), 0)) as unclassified_amt,
         (COALESCE(sum(total_in_amt), 0) + COALESCE(sum(total_out_amt), 0)) as total_amt
       FROM ${dmSchema}.v_coverage_by_file
       WHERE import_status = 'success'
       `
     );

     const row = coverageAgg.rows[0] || {};
     const unclassifiedCount = parseInt(row.unclassified_count) || 0;
     const unclassifiedAmt = parseFloat(row.unclassified_amt) || 0;
     const totalAmt = parseFloat(row.total_amt) || 0;
     const unclassifiedPct = totalAmt > 0 ? Math.round((unclassifiedAmt / totalAmt) * 100 * 100) / 100 : 0;

     // Top keywords：在 VPS 上代价较高（需要扫未分类明细），先返回空数组保证页面秒开。
     const topKeywords: any[] = [];

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