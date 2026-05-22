-- Rule history / rollback support (A2)
-- Stores all changes of bank_rule_map into ops.bank_rule_map_history via triggers.

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.bank_rule_map_history (
  history_id   BIGSERIAL PRIMARY KEY,
  brand_code   TEXT NOT NULL,
  cfg_schema   TEXT NOT NULL,
  rule_id      BIGINT,
  op           TEXT NOT NULL, -- INSERT|UPDATE|DELETE
  changed_by   TEXT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  before_row   JSONB,
  after_row    JSONB
);

CREATE INDEX IF NOT EXISTS idx_rule_hist_brand_rule_time
  ON ops.bank_rule_map_history(brand_code, rule_id, changed_at DESC);

CREATE OR REPLACE FUNCTION ops.fn_log_bank_rule_map_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_user TEXT;
  v_brand TEXT;
BEGIN
  v_user := current_setting('wdg.user', true);
  v_brand := COALESCE(TG_ARGV[0], 'unknown');

  IF (TG_OP = 'INSERT') THEN
    INSERT INTO ops.bank_rule_map_history(
      brand_code, cfg_schema, rule_id, op, changed_by, before_row, after_row
    ) VALUES (
      v_brand, TG_TABLE_SCHEMA, NEW.rule_id, TG_OP, v_user, NULL, to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO ops.bank_rule_map_history(
      brand_code, cfg_schema, rule_id, op, changed_by, before_row, after_row
    ) VALUES (
      v_brand, TG_TABLE_SCHEMA, NEW.rule_id, TG_OP, v_user, to_jsonb(OLD), to_jsonb(NEW)
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO ops.bank_rule_map_history(
      brand_code, cfg_schema, rule_id, op, changed_by, before_row, after_row
    ) VALUES (
      v_brand, TG_TABLE_SCHEMA, OLD.rule_id, TG_OP, v_user, to_jsonb(OLD), NULL
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$fn$;

-- Install triggers for current brands (can be extended later)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='yufeng_cfg' AND table_name='bank_rule_map') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_bank_rule_map_history ON yufeng_cfg.bank_rule_map';
    EXECUTE 'CREATE TRIGGER trg_bank_rule_map_history '
      || 'AFTER INSERT OR UPDATE OR DELETE ON yufeng_cfg.bank_rule_map '
      || 'FOR EACH ROW EXECUTE FUNCTION ops.fn_log_bank_rule_map_change(''yufeng'')';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='bonjur_cfg' AND table_name='bank_rule_map') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_bank_rule_map_history ON bonjur_cfg.bank_rule_map';
    EXECUTE 'CREATE TRIGGER trg_bank_rule_map_history '
      || 'AFTER INSERT OR UPDATE OR DELETE ON bonjur_cfg.bank_rule_map '
      || 'FOR EACH ROW EXECUTE FUNCTION ops.fn_log_bank_rule_map_change(''bonjur'')';
  END IF;
END$$;
