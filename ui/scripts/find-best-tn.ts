/**
 * Sample bank + qimai for MEITUAN to find best T+n offset
 */
import { Pool } from 'pg';

// Read DB password from env like the rest of the codebase
const DB_USER = process.env['DB_USER'] || 'admin_jlin13';
const DB_PASSWORD = process.env['DB_PASSWORD'];
const DB_HOST = process.env['DB_HOST'] || '112.124.18.246';
const DB_PORT = process.env['DB_PORT'] || '9742';
const DB_NAME = process.env['DB_NAME'] || 'dataplatform';

if (!DB_PASSWORD) {
  console.error('ERROR: DB_PASSWORD environment variable required');
  console.error('Usage: DB_PASSWORD=... npx ts-node scripts/find-best-tn.ts');
  process.exit(1);
}

const pool = new Pool({
  connectionString: `postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`,
});

interface Result {
  n: number;
  matched: number;       // rows with qimai > 0
  matched_pct: number;   // matched / total bank rows
  mean_abs_diff: number; // mean |diff| over matched rows
  mean_pct: number;      // mean bank/qimai * 100
  zero_qimai_pct: number; // % bank rows with qimai = 0
}

async function main() {
  const bankQuery = await pool.query(`
    SELECT txn_time::date AS bank_date, store_code,
      SUM(COALESCE(in_amt,0)) AS bank_amt
    FROM brand_tamkoko_ods.bank_txn t
    JOIN brand_tamkoko_dm.bank_txn_classified_snapshot c ON c.bank_txn_id=t.id
    WHERE c.lvl2_code='MEITUAN' AND c.classified_source IN ('rule','override')
      AND t.summary NOT LIKE '%团购%' AND t.in_amt > 0
    GROUP BY txn_time::date, store_code
    ORDER BY bank_date
  `);
  const totalBankRows = bankQuery.rows.length;
  console.log('Total bank rows:', totalBankRows);

  const results: Result[] = [];

  for (let n = 0; n <= 7; n++) {
    const r: Result = { n, matched: 0, matched_pct: 0, mean_abs_diff: 0, mean_pct: 0, zero_qimai_pct: 0 };
    let absDiffSum = 0;
    let pctSum = 0;
    let zeroCount = 0;
    for (const b of bankQuery.rows) {
      const q = await pool.query(`
        SELECT COALESCE(SUM(net_amt), 0) AS qimai_amt
        FROM brand_tamkoko_ods.income_detail
        WHERE store_code=$1 AND biz_date=$2::date - $3::int
          AND NOT is_refund AND NOT is_member_payment
          AND (payment_methods @> ARRAY['美团外卖支付']::text[] OR payment_methods @> ARRAY['美团在线点单']::text[])
          AND NOT (payment_methods @> ARRAY['美团团购券']::text[])
      `, [b.store_code, b.bank_date, n]);
      const qimai = Number(q.rows[0].qimai_amt);
      const bank = Number(b.bank_amt);
      if (qimai > 0) {
        r.matched++;
        absDiffSum += Math.abs(bank - qimai);
        pctSum += (bank / qimai) * 100;
      } else {
        zeroCount++;
      }
    }
    r.matched_pct = (r.matched / totalBankRows) * 100;
    r.zero_qimai_pct = (zeroCount / totalBankRows) * 100;
    r.mean_abs_diff = r.matched > 0 ? absDiffSum / r.matched : 0;
    r.mean_pct = r.matched > 0 ? pctSum / r.matched : 0;
    results.push(r);
    console.log(
      `T+${n}: matched=${r.matched}/${totalBankRows} (${r.matched_pct.toFixed(1)}%)  ` +
      `zero=${r.zero_qimai_pct.toFixed(1)}%  ` +
      `mean_abs_diff=${r.mean_abs_diff.toFixed(2)}  mean_pct=${r.mean_pct.toFixed(2)}%`
    );
  }
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
