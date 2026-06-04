-- ============================================================
-- 1) v_inventory_summary：按 store × period 汇总库存金额
-- ============================================================

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_inventory_summary AS
SELECT
  store_code,
  period,
  SUM(amount)                          AS total_inventory_amt,
  COUNT(DISTINCT sku)                  AS sku_count,
  COUNT(*) FILTER (WHERE amount > 0)   AS active_sku_count
FROM brand_tamkoko_ods.inventory_month_end
GROUP BY store_code, period;

-- ============================================================
-- 2) v_cogs_monthly：COGS = 期初 + 采购 − 期末
--    opening_amt = LAG(closing_amt) per store  （首期 NULL）
--    purchase_amt = bank_txn EXP_MATERIAL 期间合计（lvl1_code='MATERIAL'）
--    closing_amt  = current period total_inventory_amt
--    cogs_amt     = opening + purchase − closing （首期 NULL）
-- ============================================================

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_cogs_monthly AS
WITH material_purchase AS (
  SELECT
    t.store_code,
    to_char(date_trunc('month', t.txn_time), 'YYYY-MM') AS period,
    SUM(ABS(COALESCE(t.out_amt, 0))) AS purchase_amt
  FROM brand_tamkoko_ods.bank_txn t
  JOIN brand_tamkoko_dm.bank_txn_classified_snapshot c
    ON c.bank_txn_id = t.id
  WHERE c.classified_source IN ('rule', 'override')
    AND c.lvl1_code = 'MATERIAL'
  GROUP BY t.store_code, date_trunc('month', t.txn_time)
),
inv AS (
  SELECT store_code, period, total_inventory_amt
  FROM brand_tamkoko_dm.v_inventory_summary
)
SELECT
  inv.store_code,
  inv.period,
  LAG(inv.total_inventory_amt) OVER (
    PARTITION BY inv.store_code ORDER BY inv.period
  ) AS opening_amt,
  COALESCE(mp.purchase_amt, 0) AS purchase_amt,
  inv.total_inventory_amt AS closing_amt,
  CASE
    WHEN LAG(inv.total_inventory_amt) OVER (
           PARTITION BY inv.store_code ORDER BY inv.period
         ) IS NULL THEN NULL
    ELSE
      LAG(inv.total_inventory_amt) OVER (
        PARTITION BY inv.store_code ORDER BY inv.period
      ) + COALESCE(mp.purchase_amt, 0) - inv.total_inventory_amt
  END AS cogs_amt
FROM inv
LEFT JOIN material_purchase mp
  ON mp.store_code = inv.store_code
 AND mp.period     = inv.period;
