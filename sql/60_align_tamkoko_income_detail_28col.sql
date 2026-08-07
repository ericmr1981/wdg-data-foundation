-- 幂等对齐 brand_tamkoko_ods.income_detail 为 28 列新 schema（issue #41）
-- 适用场景：既有环境（dev/VPS）的表仍是旧 16 列结构（CREATE TABLE IF NOT EXISTS 不会修复漂移）。
-- 只 ADD COLUMN IF NOT EXISTS，不修改已有列类型/约束，可重复执行。

ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS store_name          TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS order_no_clean      TEXT NOT NULL DEFAULT '';
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS pay_time            TIMESTAMPTZ;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS order_time          TIMESTAMPTZ;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS discount_amt        NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS overflow_amt        NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS coupon_fee          NUMERIC(14,2) NOT NULL DEFAULT 0;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS third_party_order_no TEXT;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS merchant_order_no   TEXT;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS coupon_id           TEXT;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS is_refund           BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS is_member_payment   BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS member_id           TEXT;
ALTER TABLE brand_tamkoko_ods.income_detail ADD COLUMN IF NOT EXISTS member_phone        TEXT;

-- 索引（幂等）
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_biz_date
  ON brand_tamkoko_ods.income_detail (biz_date);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_store_biz_date
  ON brand_tamkoko_ods.income_detail (store_code, biz_date);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_pay_time
  ON brand_tamkoko_ods.income_detail (pay_time);
CREATE INDEX IF NOT EXISTS idx_tamkoko_income_detail_member
  ON brand_tamkoko_ods.income_detail (member_id) WHERE member_id IS NOT NULL;

-- 约束检查：脚本 ON CONFLICT (store_code, order_no_clean) 依赖该唯一索引。
-- 先回填旧行（补列 DEFAULT '' 的行），再幂等创建索引，保证迁移自洽可重复执行。
UPDATE brand_tamkoko_ods.income_detail
   SET order_no_clean = trim(BOTH '`' FROM order_no)
 WHERE order_no_clean = '' AND order_no IS NOT NULL;

-- 用独立名 uq_tamkoko_income_detail_clean：旧 16 列 schema 的同名约束
-- uq_tamkoko_income_detail UNIQUE (store_code, order_no) 仍可能存在，
-- IF NOT EXISTS 按名字判重会静默跳过同名不同定义的索引（issue #41 审查发现）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_tamkoko_income_detail_clean
  ON brand_tamkoko_ods.income_detail (store_code, order_no_clean);

-- 说明：实测本地/VPS 唯一索引可能名为 uq_tamkoko_income_order（名称不影响 ON CONFLICT 匹配）；
-- 若已存在 (store_code, order_no_clean) 的其他唯一约束，此索引创建会失败，请先人工确认。
