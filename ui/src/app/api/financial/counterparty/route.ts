import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeBrand, getDmSchemaSafe, getOdsBankTxnTable } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parsePeriod } from '../period-utils';
import { getErrorMessage } from '@/lib/query-types';

// GET /api/financial/counterparty?brand=gelatomiiix
// GET /api/financial/counterparty?brand=gelatomiiix&counterparty=xxx&period=2026-01&span=month&store=all
export async function GET(request: Request) {
  const user = await getSessionUser();
  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '';
  const span = searchParams.get('span') || 'month';
  const store = searchParams.get('store') || 'all';
  const counterparty = searchParams.get('counterparty') || '';
  const direction = searchParams.get('direction') || 'out';
  try {
    assertRole(user, ['admin', 'operator']);

    const brandParam = searchParams.get('brand') || 'gelatomiiix';
    const brand = normalizeBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ success: false, error: 'Invalid brand' }, { status: 400 });
    }

    const dmSchema = await getDmSchemaSafe(brand);
    const bankTxnTable = getOdsBankTxnTable(brand);

    // If no counterparty specified, return the list
    if (!counterparty) {
      const isIn = direction === 'in';
      const amountField = isIn ? 'in_amt' : 'out_amt';
      const totalField = isIn ? 'total_received' : 'total_paid';
      const listQuery = `
        SELECT CASE
                 WHEN t.counterparty_name IS NOT NULL AND t.counterparty_name != '' THEN t.counterparty_name
                 WHEN t.purpose IS NOT NULL AND t.purpose != '' AND t.purpose != 'NaN' THEN t.purpose
                 WHEN t.summary IS NOT NULL AND t.summary != '' THEN t.summary
                 ELSE '（未知名）'
               END as counterparty_name,
               sum(coalesce(t.${amountField}, 0)) as ${totalField},
               count(*) as txn_count,
               min(t.txn_time) as first_date,
               max(t.txn_time) as last_date
        FROM ${bankTxnTable} t
        JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
        WHERE c.classified_source IN ('rule', 'override')
          AND coalesce(t.${amountField}, 0) > 0
        GROUP BY CASE
                   WHEN t.counterparty_name IS NOT NULL AND t.counterparty_name != '' THEN t.counterparty_name
                   WHEN t.purpose IS NOT NULL AND t.purpose != '' AND t.purpose != 'NaN' THEN t.purpose
                   WHEN t.summary IS NOT NULL AND t.summary != '' THEN t.summary
                   ELSE '（未知名）'
                 END
        ORDER BY ${totalField} DESC
      `;
      const result = await pool.query(listQuery);
      return NextResponse.json({ success: true, data: { counterparties: result.rows } });
    }

    // "全部" = no date filter
    const isAll = period === 'all';
    if (!isAll) {
      if (!['month', 'quarter', 'year'].includes(span)) {
        return NextResponse.json({ success: false, error: 'Invalid span' }, { status: 400 });
      }
      const boundaries = parsePeriod(period, span);
      if (!boundaries) {
        return NextResponse.json({ success: false, error: 'Invalid period format' }, { status: 400 });
      }
    }

    const params: (string | number)[] = [counterparty];
    let storeClause = '';
    let dateClause = '';
    if (store !== 'all') {
      storeClause = 'AND t.store_code = $' + (params.length + 1);
      params.push(store);
    }
    if (!isAll) {
      const boundaries = parsePeriod(period, span)!;
      dateClause = 'AND t.txn_time >= $' + (params.length + 1) + '::timestamp AND t.txn_time < $' + (params.length + 2) + '::timestamp';
      params.push(boundaries[0], boundaries[1]);
    }

    const isIn = direction === 'in';
    const amountField = isIn ? 'in_amt' : 'out_amt';
    const totalField = isIn ? 'period_received' : 'period_total';

    const conditions = `
      WHERE (t.counterparty_name = $1 OR t.purpose = $1 OR t.summary = $1)
        AND c.classified_source IN ('rule', 'override')
        AND coalesce(t.${amountField}, 0) > 0
        ${dateClause}
        ${storeClause}
    `;

    const detailQuery = `
      SELECT to_char(t.txn_time, 'YYYY-MM') as month,
             t.txn_time,
             t.summary,
             t.memo,
             t.purpose,
             ${isIn ? 't.in_amt as amount' : 't.out_amt as amount'},
             t.balance_amt,
             t.store_code,
             c.lvl1_code,
             c.lvl2_code,
             l1.lvl1_name,
             l2.lvl2_name
      FROM ${bankTxnTable} t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      LEFT JOIN ${dmSchema.substring(0, dmSchema.lastIndexOf('_'))}_cfg.dim_category_lvl1 l1 ON l1.lvl1_code = c.lvl1_code
      LEFT JOIN ${dmSchema.substring(0, dmSchema.lastIndexOf('_'))}_cfg.dim_category_lvl2 l2 ON l2.lvl1_code = c.lvl1_code AND l2.lvl2_code = c.lvl2_code
      ${conditions}
      ORDER BY t.txn_time DESC
    `;
    const result = await pool.query(detailQuery, params);

    const totalQuery = `
      SELECT sum(coalesce(t.${amountField}, 0)) as ${totalField},
             count(*) as period_count
      FROM ${bankTxnTable} t
      JOIN ${dmSchema}.bank_txn_classified_snapshot c ON c.bank_txn_id = t.id
      ${conditions}
    `;
    const totalRes = await pool.query(totalQuery, params);

    const dataTotal = Number(totalRes.rows[0]?.[totalField] || 0);

    return NextResponse.json({
      success: true,
      data: {
        counterparty,
        period, span, store, direction,
        period_total: dataTotal,
        period_count: Number(totalRes.rows[0]?.period_count || 0),
        transactions: result.rows
      }
    });

  } catch (error: unknown) {
    const errRecord = error as Record<string, unknown>;
    if (errRecord?.code === '42P01') {
      return NextResponse.json({ success: true, data: { counterparties: [] } });
    }
    console.error('Error in counterparty route:', error);
    const status = (errRecord?.status as number) || 500;
    return NextResponse.json({ success: false, error: getErrorMessage(error) || 'Failed' }, { status });
  }
}
