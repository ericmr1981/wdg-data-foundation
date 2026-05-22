import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getCfgRuleTable } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

const UPSERT_COLS = [
  'enabled',
  'priority',
  'direction',
  'match_field',
  'match_type',
  'match_value',
  'match_field2',
  'match_value2',
  'lvl1_code',
  'lvl2_code',
  'note'
] as const;

// POST /api/rules/rollback
// body: { brand, history_id, to?: 'before'|'after' }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);

    const body = await request.json();
    const brand = normalizeBrand(body.brand || 'yufeng');
    if (!brand) return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });

    const historyId = Number(body.history_id);
    const to = (body.to === 'after' ? 'after' : 'before') as 'before' | 'after';
    if (!historyId) return NextResponse.json({ success: false, error: 'Missing history_id' }, { status: 400 });

    const histRes = await pool.query(
      `
      SELECT history_id, rule_id, op, before_row, after_row
      FROM ops.bank_rule_map_history
      WHERE history_id=$1 AND brand_code=$2
      LIMIT 1
      `,
      [historyId, brand]
    );

    if (histRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'History not found' }, { status: 404 });
    }

    const h = histRes.rows[0];
    const state = to === 'before' ? h.before_row : h.after_row;
    const ruleTable = getCfgRuleTable(brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // Rollback INSERT -> delete the inserted rule
      if (!state) {
        await client.query(`DELETE FROM ${ruleTable} WHERE rule_id=$1`, [h.rule_id]);
        await client.query('COMMIT');
        return NextResponse.json({ success: true, data: { action: 'deleted', rule_id: h.rule_id } });
      }

      // Upsert to desired state (includes rule_id)
      const cols = ['rule_id', ...UPSERT_COLS];
      const values: any[] = [Number(h.rule_id)];
      for (const c of UPSERT_COLS) {
        values.push(state[c] ?? null);
      }

      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const updates = UPSERT_COLS.map((c) => `${c}=EXCLUDED.${c}`).join(', ');

      await client.query(
        `
        INSERT INTO ${ruleTable} (${cols.join(',')})
        VALUES (${placeholders})
        ON CONFLICT (rule_id) DO UPDATE SET ${updates}
        `,
        values
      );

      await client.query('COMMIT');
      return NextResponse.json({ success: true, data: { action: 'upsert', rule_id: h.rule_id } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    const status = err?.status || 500;
    return NextResponse.json({ success: false, error: err.message || 'Failed' }, { status });
  }
}
