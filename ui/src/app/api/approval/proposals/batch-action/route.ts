import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getCfgSchema, getDmSchema, getOdsBankTxnTable, getCfgRuleTable, normalizeBrand } from '@/lib/brand-server';

// POST /api/approval/proposals/batch-action
// Body: { action: 'approve'|'reject', proposal_ids: string[], resolved_by: string, brand: string }
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, proposal_ids, resolved_by, brand: brandParam } = body as {
      action: 'approve' | 'reject';
      proposal_ids: string[];
      resolved_by: string;
      brand: string;
    };

    if (!action || !proposal_ids || !Array.isArray(proposal_ids) || proposal_ids.length === 0) {
      return NextResponse.json({ success: false, error: 'Missing required fields: action, proposal_ids' }, { status: 400 });
    }
    if (!resolved_by) {
      return NextResponse.json({ success: false, error: 'Missing required field: resolved_by' }, { status: 400 });
    }

    const brand = normalizeBrand(brandParam || 'yufeng') || 'yufeng';
    const cfgSchema = getCfgSchema(brand);
    const dmSchema = getDmSchema(brand);
    const bankTxnTable = getOdsBankTxnTable(brand);
    const ruleTable = getCfgRuleTable(brand);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      // Fetch proposals
      const result = await client.query(
        `SELECT proposal_id, bank_txn_id, brand_code, type, status,
                llm_lvl1_code, llm_lvl2_code, llm_keyword, llm_match_field,
                final_lvl1_code, final_lvl2_code, final_keyword, final_match_field
         FROM ops.approval_proposal
         WHERE proposal_id = ANY($1)
           AND status = 'pending'`,
        [proposal_ids]
      );

      const pending = result.rows;
      if (pending.length === 0) {
        await client.query('COMMIT');
        return NextResponse.json({ success: true, executed: 0, rejected: 0, pending_waiting_info: 0, note: 'no pending proposals found' });
      }

      let executed = 0;
      let rejected = 0;
      let pending_waiting_info = 0;

      if (action === 'reject') {
        await client.query(
          `UPDATE ops.approval_proposal
           SET status = 'rejected', resolved_at = now(), resolved_by = $1
           WHERE proposal_id = ANY($2)
             AND status = 'pending'`,
          [resolved_by, proposal_ids]
        );
        rejected = pending.length;

      } else if (action === 'approve') {
        for (const proposal of pending) {
          if (proposal.type === 'type2') {
            // Info missing → keep pending, just touch resolved_by
            pending_waiting_info++;
            continue;
          }

          // type1: settle the LLM recommendation as a rule
          const lvl1Code = proposal.final_lvl1_code || proposal.llm_lvl1_code;
          const lvl2Code = proposal.final_lvl2_code || proposal.llm_lvl2_code;
          const keyword = proposal.final_keyword || proposal.llm_keyword;
          const matchField = proposal.final_match_field || proposal.llm_match_field || 'summary';

          if (!lvl1Code || !keyword) {
            // Incomplete → keep pending
            pending_waiting_info++;
            continue;
          }

          // Resolve lvl1_name from code
          const lvl1Res = await client.query(
            `SELECT lvl1_name FROM ${cfgSchema}.dim_category_lvl1 WHERE lvl1_code = $1 LIMIT 1`,
            [lvl1Code]
          );
          if (lvl1Res.rows.length === 0) {
            pending_waiting_info++;
            continue;
          }
          const lvl1Name = lvl1Res.rows[0].lvl1_name;

          // Resolve lvl2_name from code (optional)
          let lvl2Name: string | null = null;
          if (lvl2Code) {
            const lvl2Res = await client.query(
              `SELECT lvl2_name FROM ${cfgSchema}.dim_category_lvl2 WHERE lvl1_code=$1 AND lvl2_code=$2 LIMIT 1`,
              [lvl1Code, lvl2Code]
            );
            lvl2Name = lvl2Res.rows.length > 0 ? lvl2Res.rows[0].lvl2_name : null;
          }

          // Get txn direction
          let direction = 'any';
          const txnRes = await client.query(
            `SELECT in_amt, out_amt FROM ${bankTxnTable} WHERE id = $1`,
            [proposal.bank_txn_id]
          );
          if (txnRes.rows.length > 0) {
            if (txnRes.rows[0].in_amt > 0) direction = 'in';
            else if (txnRes.rows[0].out_amt > 0) direction = 'out';
          }

          const matchType = matchField === 'counterparty_name' ? 'exact' : 'contains';

          // Get next priority
          const priRes = await client.query(
            `SELECT COALESCE(MAX(priority), 0) + 10 as new_priority FROM ${ruleTable}`
          );
          const newPriority = priRes.rows[0].new_priority;

          // Write rule
          const ruleRes = await client.query(
            `
            INSERT INTO ${ruleTable}
            (enabled, priority, match_field, match_type, match_value, direction, lvl1_code, lvl2_code, note)
            VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING rule_id
            `,
            [newPriority, matchField, matchType, keyword, direction, lvl1Code, lvl2Code, `Approval 沉淀: txn ${proposal.bank_txn_id}`]
          );

          const createdRule = ruleRes.rows[0];

          // Write override
          await client.query(
            `
            INSERT INTO ${dmSchema}.bank_txn_override (bank_txn_id, lvl1_code, lvl2_code, note, created_by)
            VALUES ($1, $2, $3, $4, 'approval')
            ON CONFLICT (bank_txn_id) DO UPDATE SET
              lvl1_code = EXCLUDED.lvl1_code,
              lvl2_code = EXCLUDED.lvl2_code,
              note = EXCLUDED.note,
              updated_at = now()
            `,
            [proposal.bank_txn_id, lvl1Code, lvl2Code, `Approval 沉淀: ${matchField} ${matchType} ${keyword}`]
          );

          // Refresh snapshot best-effort
          try {
            const fileRes = await client.query(
              `SELECT source_file_id FROM ${bankTxnTable} WHERE id = $1`,
              [proposal.bank_txn_id]
            );
            const sfi = fileRes.rows?.[0]?.source_file_id;
            if (sfi) {
              await client.query(`SELECT ${dmSchema}.refresh_bank_txn_classified_snapshot($1)`, [sfi]);
            }
          } catch (e) { /* best-effort */ }

          executed++;
        }

        // Mark all as executed / rejected in bulk
        const toExecute = pending
          .filter(p => p.type === 'type1' && (p.final_lvl1_code || p.llm_lvl1_code) && (p.final_keyword || p.llm_keyword))
          .map(p => p.proposal_id);

        const toKeepPending = pending
          .filter(p => p.type === 'type2' || (!p.final_lvl1_code && !p.llm_lvl1_code) || (!p.final_keyword && !p.llm_keyword))
          .map(p => p.proposal_id);

        if (toExecute.length > 0) {
          await client.query(
            `UPDATE ops.approval_proposal
             SET status = 'executed', resolved_at = now(), resolved_by = $1
             WHERE proposal_id = ANY($2)`,
            [resolved_by, toExecute]
          );
        }

        if (toKeepPending.length > 0) {
          await client.query(
            `UPDATE ops.approval_proposal
             SET resolved_by = $1
             WHERE proposal_id = ANY($2)`,
            [resolved_by, toKeepPending]
          );
        }
      }

      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        executed,
        rejected,
        pending_waiting_info: pending_waiting_info + (action === 'approve' ? 0 : 0)
      });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error in batch-action:', error);
    return NextResponse.json({ success: false, error: 'Failed to execute batch action' }, { status: 500 });
  }
}