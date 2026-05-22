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

     // 注意：v_coverage_by_file / v_bank_txn_classified 视图会触发全量分类，在 VPS 上极慢（60s+）。
     // 临时方案：直接从 ods.bank_txn 读总额（秒级），未分类 KPI 先返回 0（保证页面秒开）。
     const totalResult = await pool.query(
       `
       SELECT sum(coalesce(in_amt, 0) + coalesce(out_amt, 0)) as total_amt
       FROM ${bankTxnTable}
       `
     );

     const totalAmt = parseFloat(totalResult.rows[0]?.total_amt) || 0;
     const unclassifiedCount = 0;
     const unclassifiedAmt = 0;
     const unclassifiedPct = 0;

     // Top keywords：暂时跳过（避免触发全量分类）
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