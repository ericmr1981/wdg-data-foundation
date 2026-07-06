-- ============================================================================
-- tests/sql/test_inventory_summary.sql
-- 验证 v_cogs_monthly.closing_amt 在新表与旧 SKU 表之间的 fallback 行为，
-- 以及 v_inventory_turnover 的计算正确性。
-- 运行方式（脚本读取 raw.ingest_file 之外，不依赖外部 fixture）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/test_inventory_summary.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- 测试直接在 brand_tamkoko_ods 操作，插入的数据在末尾 ROLLBACK

-- ── 1) 仅有 SKU：fallback 路径
INSERT INTO brand_tamkoko_ods.inventory_month_end
  (brand_code, store_code, period, category, sku, material_name, unit_price, qty, unit, amount, source_file_id)
VALUES
  ('tamkoko', 'hz_fuyang', '2099-01', '常温物料', 'SKU-A', '材料A', 10, 5, '箱', 50, 999001),
  ('tamkoko', 'hz_fuyang', '2099-01', '包装材料', 'SKU-B', '材料B', 20, 5, '箱', 100, 999001);

-- 无 summary 行 → closing_amt 应来自 SKU SUM (=150)
DO $$
DECLARE got NUMERIC;
BEGIN
  SELECT closing_amt INTO got FROM brand_tamkoko_dm.v_cogs_monthly
   WHERE store_code = 'hz_fuyang' AND period = '2099-01';
  IF got IS DISTINCT FROM 150 THEN
    RAISE EXCEPTION 'SKU-only fallback: expected 150, got %', got;
  END IF;
END $$;

-- ── 2) 新表优先
INSERT INTO brand_tamkoko_ods.inventory_monthly_summary
  (store_code, period, total_amount, updated_by)
VALUES ('hz_fuyang', '2099-01', 999.99, 'test');

DO $$
DECLARE got NUMERIC;
BEGIN
  SELECT closing_amt INTO got FROM brand_tamkoko_dm.v_cogs_monthly
   WHERE store_code = 'hz_fuyang' AND period = '2099-01';
  IF got IS DISTINCT FROM 999.99 THEN
    RAISE EXCEPTION 'Summary priority: expected 999.99, got %', got;
  END IF;
END $$;

-- ── 3) 周转：v_inventory_turnover 的 sanity 检查
--  目标公式（plan）：
--    opening=100, closing=300, cogs=200 → turnover_times = 200/200 = 1.00
--                                          turnover_days  = 30/1.00 = 30.0
--  当前限制（Task 4 之前）：
--    - v_inventory_turnover 尚未创建（Task 4 会建），所以这个块只能做
--      "view 不崩 / NULL 边界" 的 sanity 断言。
--    - cogs_amt 来自 bank_txn MATERIAL 分类，构造一个确定性 200 需要
--      在 bank_txn_classified_snapshot 里塞入带规则映射的 MATERIAL 行
--      —— 超出本测试的 fixture 范围。
--    - 当 Task 4 落地后，应替换为：seed SKU 让 opening=100（2098-12 期末）、
--      closing=300（2099-01 期末），构造 cogs=200 的 MATERIAL 行，再断言
--      turnover_times=1.00 / turnover_days=30.0。
--  本块现在的 setup：插入 2098-12 SKU 行（amount=100）作为 opening 来源，
--  并保留前两块遗留的 2099-01 行（amount SUM=150）作为 closing 来源。

-- opening 来源：2098-12 期末 SKU（amount=100）
INSERT INTO brand_tamkoko_ods.inventory_month_end
  (brand_code, store_code, period, category, sku, material_name, unit_price, qty, unit, amount, source_file_id)
VALUES
  ('tamkoko', 'hz_fuyang', '2098-12', '常温物料', 'SKU-OPEN', '前期结存', 10, 10, '箱', 100, 999001);

DO $$
DECLARE view_oid  OID;
DECLARE got_times NUMERIC;
DECLARE got_days  NUMERIC;
BEGIN
  -- 如果 v_inventory_turnover 尚未创建（Task 4），跳过数值断言。
  -- TODO(Task 4): 替换为 turnover_times = 1.00 / turnover_days = 30.0
  view_oid := to_regclass('brand_tamkoko_dm.v_inventory_turnover');
  IF view_oid IS NULL THEN
    RAISE NOTICE 'v_inventory_turnover not yet created (Task 4); skipping numeric assertion';
    RETURN;
  END IF;

  SELECT turnover_times, turnover_days INTO got_times, got_days
    FROM brand_tamkoko_dm.v_inventory_turnover
   WHERE store_code = 'hz_fuyang' AND period IN ('2098-12', '2099-01');

  IF got_times IS NOT NULL AND (got_times < 0) THEN
    RAISE EXCEPTION 'turnover_times should be NULL or >= 0, got %', got_times;
  END IF;
  IF got_days IS NOT NULL AND (got_days < 0) THEN
    RAISE EXCEPTION 'turnover_days should be NULL or >= 0, got %', got_days;
  END IF;
END $$;

-- 清理
DELETE FROM brand_tamkoko_ods.inventory_monthly_summary
 WHERE store_code = 'hz_fuyang' AND period = '2099-01';
DELETE FROM brand_tamkoko_ods.inventory_month_end
 WHERE store_code = 'hz_fuyang' AND period IN ('2098-12', '2099-01') AND source_file_id = 999001;

ROLLBACK;
