-- ============================================================================
-- Tamkoko DM views
--   v_inventory_summary：按 store × period 汇总 SKU 级库存金额（fallback source）。
--   v_cogs_monthly：COGS = 期初 + 采购 − 期末
--     opening_amt = LAG(closing_amt) per store  （首期 NULL）
--     purchase_amt = bank_txn EXP_MATERIAL 期间合计（lvl1_code='MATERIAL'）
--     closing_amt 优先读 inventory_monthly_summary（UI 录入），缺失时回退 SKU 明细。
--     cogs_amt     = opening + purchase − closing
--       当期初或期末任一为 NULL 时，cogs 降级为 purchase
--       （无法计算库存变动 → 假设"无变动"，仅记银行侧采购）
--     期间集合 = UNION(有库存的月份, 有银行 MATERIAL 采购的月份)
--       即便没有库存盘点，只要银行有物料采购，该月也出现在结果中
--       此时 opening 与 closing 都为 NULL，cogs = purchase
--   v_inventory_turnover：周转次数 = COGS / 平均库存；周转天数 = 30 / 次数。
-- ============================================================================

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_inventory_summary AS
SELECT
  store_code,
  period,
  SUM(amount)                          AS total_inventory_amt,
  COUNT(DISTINCT sku)                  AS sku_count,
  COUNT(*) FILTER (WHERE amount > 0)   AS active_sku_count
FROM brand_tamkoko_ods.inventory_month_end
GROUP BY store_code, period;

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
  -- closing 优先读月度盘点总额（管理员在 /u/inventory 录入）；
  -- 缺失时回退到 SKU 明细 SUM(amount)。一次一行 (store, period)。
  SELECT s.store_code, s.period, s.total_amount AS total_inventory_amt
    FROM brand_tamkoko_ods.inventory_monthly_summary s
  UNION ALL
  SELECT store_code, period, SUM(amount) AS total_inventory_amt
    FROM brand_tamkoko_ods.inventory_month_end
   WHERE NOT EXISTS (
     SELECT 1 FROM brand_tamkoko_ods.inventory_monthly_summary m
      WHERE m.store_code = inventory_month_end.store_code
        AND m.period     = inventory_month_end.period
   )
   GROUP BY store_code, period
),
periods AS (
  -- All periods that have either inventory OR bank MATERIAL purchase
  SELECT store_code, period FROM inv
  UNION
  SELECT store_code, period FROM material_purchase
)
SELECT
  p.store_code,
  p.period,
  LAG(i.total_inventory_amt) OVER (
    PARTITION BY p.store_code ORDER BY p.period
  ) AS opening_amt,
  COALESCE(mp.purchase_amt, 0) AS purchase_amt,
  i.total_inventory_amt AS closing_amt,
  CASE
    WHEN LAG(i.total_inventory_amt) OVER (
           PARTITION BY p.store_code ORDER BY p.period
         ) IS NULL
      AND i.total_inventory_amt IS NULL
    THEN COALESCE(mp.purchase_amt, 0)
    WHEN LAG(i.total_inventory_amt) OVER (
           PARTITION BY p.store_code ORDER BY p.period
         ) IS NULL
      OR i.total_inventory_amt IS NULL
    THEN COALESCE(mp.purchase_amt, 0)
    ELSE
      LAG(i.total_inventory_amt) OVER (
        PARTITION BY p.store_code ORDER BY p.period
      ) + COALESCE(mp.purchase_amt, 0) - i.total_inventory_amt
  END AS cogs_amt
FROM periods p
LEFT JOIN inv           i  ON i.store_code  = p.store_code AND i.period  = p.period
LEFT JOIN material_purchase mp ON mp.store_code = p.store_code AND mp.period = p.period;

-- ============================================================================
-- v_inventory_turnover：库存周转（次数 / 天数）
--   turnover_times = COGS / ((opening + closing) / 2)
--   turnover_days  = 30 / turnover_times
--   缺 opening/closing 或 平均库存=0 时回 NULL（避免除零）。
-- ============================================================================

CREATE OR REPLACE VIEW brand_tamkoko_dm.v_inventory_turnover AS
SELECT
  c.store_code,
  c.period,
  c.cogs_amt,
  c.opening_amt,
  c.closing_amt,
  CASE
    WHEN c.opening_amt IS NULL OR c.closing_amt IS NULL THEN NULL
    WHEN ((c.opening_amt + c.closing_amt) / 2) = 0 THEN NULL
    ELSE ROUND((c.cogs_amt / ((c.opening_amt + c.closing_amt) / 2))::numeric, 2)
  END AS turnover_times,
  CASE
    WHEN c.cogs_amt IS NULL OR c.cogs_amt = 0 THEN NULL
    WHEN c.opening_amt IS NULL OR c.closing_amt IS NULL THEN NULL
    ELSE ROUND((((c.opening_amt + c.closing_amt) / 2) / c.cogs_amt * 30)::numeric, 1)
  END AS turnover_days
FROM brand_tamkoko_dm.v_cogs_monthly c;
