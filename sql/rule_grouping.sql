-- Add group_name column to all *_cfg.bank_rule_map tables (B)

DO $$
DECLARE
  r record;
  cfg_schema text;
BEGIN
  FOR r IN SELECT brand_code, schema_prefix FROM ops.brands WHERE enabled=true LOOP
    IF r.schema_prefix IN ('yufeng','bonjur') THEN
      cfg_schema := r.schema_prefix || '_cfg';
    ELSE
      cfg_schema := r.schema_prefix || '_cfg';
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = cfg_schema AND table_name = 'bank_rule_map'
    ) THEN
      EXECUTE format('ALTER TABLE %I.bank_rule_map ADD COLUMN IF NOT EXISTS group_name text', cfg_schema);
    END IF;
  END LOOP;
END $$;
