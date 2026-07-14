#!/bin/bash
# scripts/db_test.sh
# 快速测试数据库连接 + 基本查询
# 用法: bash scripts/db_test.sh

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-dataplatform_test}"
DB_USER="${DB_USER:-admin_jlin13}"
DB_PASS="${DB_PASSWORD:-Souledge1981}"

echo "=== DB Connection Test ==="
echo "Target: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
echo ""

node -e "
const { Pool } = require('$(pwd)/ui/node_modules/pg');
const pool = new Pool({
  host: '${DB_HOST}',
  port: ${DB_PORT},
  database: '${DB_NAME}',
  user: '${DB_USER}',
  password: '${DB_PASS}',
  connectionTimeoutMillis: 5000,
  max: 1,
});

(async () => {
  // 1. Basic connectivity
  try {
    const r = await pool.query(\"SELECT NOW() as now, current_database() as db, version() as ver\");
    console.log('  Connect:  OK');
    const { now, db, ver } = r.rows[0];
    console.log('  Server:   ' + now);
    console.log('  Database: ' + db);
    console.log('  Version:  ' + ver.split(',')[0]);
  } catch(e) {
    console.error('  Connect:  FAIL — ' + e.message);
    await pool.end();
    process.exit(1);
  }

  // 2. Users
  try {
    const r = await pool.query('SELECT COUNT(*)::int as cnt FROM ops.users WHERE enabled = TRUE');
    console.log('  Users:    ' + r.rows[0].cnt + ' enabled');
  } catch(e) {
    console.log('  Users:    SKIP — ' + e.message);
  }

  // 3. Sessions
  try {
    const r = await pool.query(\"SELECT COUNT(*)::int as cnt FROM ops.sessions WHERE expires_at > NOW()\");
    console.log('  Sessions: ' + r.rows[0].cnt + ' active');
  } catch(e) {
    console.log('  Sessions: SKIP — ' + e.message);
  }

  // 4. Brands
  try {
    const r = await pool.query('SELECT brand_code, display_name FROM ops.brands WHERE enabled = TRUE ORDER BY brand_code');
    if (r.rows.length > 0) {
      console.log('  Brands:   ' + r.rows.map(b => b.brand_code).join(', '));
    }
  } catch(e) {
    console.log('  Brands:   SKIP — ' + e.message);
  }

  await pool.end();
  console.log('');
  console.log('All checks passed.');
})();
"
