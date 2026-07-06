-- ============================================================================
-- brand_tamkoko_ods.inventory_monthly_summary
-- 月度盘点总额（每店每月一条）。替代/补充 SKU 级 inventory_month_end 的简单录入入口。
-- ============================================================================

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.inventory_monthly_summary (
  store_code    TEXT NOT NULL,
  period        TEXT NOT NULL,                                    -- 'YYYY-MM'
  total_amount  NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
  note          TEXT,
  updated_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (store_code, period)
);