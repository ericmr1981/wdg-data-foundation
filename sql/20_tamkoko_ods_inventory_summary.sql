-- ============================================================================
-- brand_tamkoko_ods.inventory_monthly_summary
-- 月度盘点总额（每店每月一条）。替代/补充 SKU 级 inventory_month_end 的简单录入入口。
-- ============================================================================

CREATE TABLE IF NOT EXISTS brand_tamkoko_ods.inventory_monthly_summary (
  store_code    text NOT NULL,
  period        text NOT NULL,                                    -- 'YYYY-MM'
  total_amount  numeric(14,2) NOT NULL CHECK (total_amount >= 0),
  note          text,
  updated_by    text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_code, period)
);