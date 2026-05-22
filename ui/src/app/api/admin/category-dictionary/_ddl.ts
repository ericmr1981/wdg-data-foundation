import pool from '@/lib/db';

// Centralized DDL to ensure default dictionary tables exist.
// We keep "default dictionary" in ops schema as single source of truth.

export async function ensureDefaultCategoryTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops.category_lvl1_default (
      lvl1_code   text PRIMARY KEY,
      lvl1_name   text NOT NULL,
      direction   text NOT NULL DEFAULT 'any',
      enabled     boolean NOT NULL DEFAULT true,
      sort_order  integer,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ops.category_lvl2_default (
      lvl1_code   text NOT NULL,
      lvl2_code   text NOT NULL,
      lvl2_name   text NOT NULL,
      enabled     boolean NOT NULL DEFAULT true,
      sort_order  integer,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (lvl1_code, lvl2_code)
    );
  `);

  // Helpful indexes for filters
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_category_lvl2_default_lvl1 ON ops.category_lvl2_default(lvl1_code);`);
}

export async function ensureBrandCategoryTables(cfgSchema: string) {
  // Create schema and brand tables used by the app.
  // NOTE: We intentionally use a minimal canonical structure compatible with existing queries.
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${cfgSchema};`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${cfgSchema}.dim_category_lvl1 (
      lvl1_code   text PRIMARY KEY,
      lvl1_name   text NOT NULL,
      direction   text NOT NULL DEFAULT 'any',
      enabled     boolean NOT NULL DEFAULT true,
      sort_order  integer,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${cfgSchema}.dim_category_lvl2 (
      lvl1_code   text NOT NULL,
      lvl2_code   text NOT NULL,
      lvl2_name   text NOT NULL,
      enabled     boolean NOT NULL DEFAULT true,
      sort_order  integer,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (lvl1_code, lvl2_code)
    );
  `);

  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_${cfgSchema.replace(/[^a-z0-9_]/gi, '_')}_dim_category_lvl2_lvl1 ON ${cfgSchema}.dim_category_lvl2(lvl1_code);`
  );
}
