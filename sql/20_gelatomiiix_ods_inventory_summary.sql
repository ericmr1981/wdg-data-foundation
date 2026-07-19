-- ============================================================================
-- brand_gelatomiiix_ods.inventory_monthly_summary
-- 月度盘点总额(每店每月一条)。蜜可诗库存页录入入口。
-- 注:蜜可诗无 COGS 计算链路,v_inventory_turnover 未定义;
--     COGS / 周转次/周转天数列对蜜可诗恒为 null,UI 展示 '-'。
-- ============================================================================

CREATE TABLE IF NOT EXISTS brand_gelatomiiix_ods.inventory_monthly_summary (
  store_code    text NOT NULL,
  period        text NOT NULL,                                    -- 'YYYY-MM'
  total_amount  numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  note          text,
  updated_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_code, period)
);
