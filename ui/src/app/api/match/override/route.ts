import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';

// DELETE /api/match/override?bank_txn_id={id}&brand=xxx - 删除 override
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bank_txn_id = searchParams.get('bank_txn_id');
    const brandParam = searchParams.get('brand') || 'yufeng';
    const brand = normalizeBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    if (!bank_txn_id) {
      return NextResponse.json({ success: false, error: 'Missing bank_txn_id' }, { status: 400 });
    }

    const schema = getDmSchema(brand);

    await pool.query(`DELETE FROM ${schema}.bank_txn_override WHERE bank_txn_id = $1`, [bank_txn_id]);

    return NextResponse.json({ success: true, message: 'Override deleted' });
  } catch (error) {
    console.error('Error deleting override:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete override' }, { status: 500 });
  }
}
