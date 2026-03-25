// =============================================================================
 // api/match/candidates/route.ts
 // 用途：match_value 候选片段生成 + 命中预览 API
 // 作者：Claude Code
 // =============================================================================

 import { NextResponse } from 'next/server';
 import pool from '@/lib/db';
 import { getDmSchema, getCfgSchema, normalizeBrand } from '@/lib/brand-server';
 import { extract_candidates_for_unclassified } from '@/lib/candidate-extractor';

 // GET /api/match/candidates?brand=xxx&bank_txn_id=123
 // 返回指定流水的 match_value 候选列表
 export async function GET(request: Request) {
   try {
     const { searchParams } = new URL(request.url);
     const brandParam = searchParams.get('brand') || 'yufeng';
     const brand = normalizeBrand(brandParam);
     const bankTxnId = searchParams.get('bank_txn_id');

     if (!brand) {
       return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
     }

     if (!bankTxnId) {
       return NextResponse.json({ success: false, error: 'Missing bank_txn_id' }, { status: 400 });
     }

     const schema = getDmSchema(brand);

     // 获取流水详情
     const result = await pool.query(
       `
       SELECT counterparty_name, summary, memo, purpose
       FROM yufeng_ods.bank_txn
       WHERE id = $1
       `,
       [bankTxnId]
     );

     if (result.rows.length === 0) {
       return NextResponse.json({ success: false, error: 'Bank txn not found' }, { status: 404 });
     }

     const txn = result.rows[0];

     // 使用 Python 脚本生成的候选项
     const candidates = extract_candidates_for_unclassified({
       counterparty_name: txn.counterparty_name || '',
       summary: txn.summary || '',
       memo: txn.memo || '',
       purpose: txn.purpose || ''
     }, 8);

     return NextResponse.json({
       success: true,
       data: {
         bank_txn_id: parseInt(bankTxnId),
         candidates
       }
     });
   } catch (error: any) {
     console.error('Error fetching candidates:', error);
     return NextResponse.json({ success: false, error: 'Failed to fetch candidates' }, { status: 500 });
   }
 }