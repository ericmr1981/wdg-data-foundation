import { Pool } from 'pg';
const pool = new Pool({ connectionString: 'postgresql://admin_jlin13:Souledge1981@112.124.18.246:9742/dataplatform' });
async function main() {
  for (const T of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const r = await pool.query(`
      WITH bank AS (
        SELECT t.txn_time::date AS bank_date, t.store_code, t.in_amt::numeric(12,2) AS bank_amt
        FROM brand_tamkoko_ods.bank_txn t
        JOIN brand_tamkoko_dm.bank_txn_classified_snapshot c ON c.bank_txn_id=t.id
        WHERE c.lvl2_code='DOUYIN' AND c.classified_source IN ('rule','override')
          AND t.in_amt > 0
      )
      SELECT bank_date, store_code, bank_amt,
        (SELECT COALESCE(SUM(net_amt), 0) FROM brand_tamkoko_ods.income_detail q
          WHERE q.store_code=b.store_code AND q.biz_date = b.bank_date - $1::int
            AND NOT q.is_refund AND NOT q.is_member_payment
            AND q.payment_methods @> ARRAY['抖音团购券']::text[]) AS qimai_amt
      FROM bank b
    `, [T]);
    const rows = r.rows;
    let matched = 0, sumPct = 0, sumAbs = 0;
    for (const row of rows) {
      const q = Number(row.qimai_amt);
      const b = Number(row.bank_amt);
      if (q > 0) {
        matched++;
        sumPct += (b / q) * 100;
        sumAbs += Math.abs(b - q);
      }
    }
    const totBank = rows.reduce((s, r) => s + Number(r.bank_amt), 0);
    const totQimai = rows.reduce((s, r) => s + Number(r.qimai_amt), 0);
    const tot_pct = totQimai > 0 ? (totBank / totQimai) * 100 : 0;
    console.log(`T+${T}: rows=${rows.length} matched=${matched} (${(matched/rows.length*100).toFixed(1)}%) mean_pct=${(sumPct/Math.max(matched,1)).toFixed(2)}% mean_abs=${(sumAbs/Math.max(matched,1)).toFixed(2)} total_pct=${tot_pct.toFixed(2)}% bank=${totBank.toFixed(0)} qimai=${totQimai.toFixed(0)}`);
  }
  await pool.end();
}
main();
