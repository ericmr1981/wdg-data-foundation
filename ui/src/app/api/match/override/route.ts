import { NextResponse } from 'next/server';
import pool from '@/lib/db';

// DELETE /api/match/override?bank_txn_id={id} - 删除 override
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bank_txn_id = searchParams.get('bank_txn_id');

    if (!bank_txn_id) {
      return NextResponse.json({ success: false, error: 'Missing bank_txn_id' }, { status: 400 });
    }

    await pool.query(`
      DELETE FROM yufeng_dm.bank_txn_override WHERE bank_txn_id = $1
    `, [bank_txn_id]);

    return NextResponse.json({ success: true, message: 'Override deleted' });
  } catch (error) {
    console.error('Error deleting override:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete override' }, { status: 500 });
  }
}
