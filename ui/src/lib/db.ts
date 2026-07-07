import { Pool, types } from 'pg';

// DATE (OID 1082) and TIMESTAMP (OID 1114) default to JS Date objects,
// which JSON.stringify renders via toISOString() in UTC. Our server is
// +08 (Asia/Shanghai), so a 'date' value of 2026-06-01 becomes
// "2026-05-31T16:00:00.000Z" — off by one calendar day. Override to keep
// the raw string format (YYYY-MM-DD) so APIs return dates without TZ shift.
types.setTypeParser(1082, (v: string) => v);
types.setTypeParser(1114, (v: string) => v);

function createPool(): Pool {
  if (!process.env.DB_PASSWORD && !process.env.DATABASE_URL) {
    return new Pool({ connectionString: 'postgresql://localhost/dataplatform' });
  }
  const user = process.env.DB_USER || 'postgres';
  const password = process.env.DB_PASSWORD || '';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || '5432';
  const db = process.env.DB_NAME || 'dataplatform';
  const baseUrl = process.env.DATABASE_URL ||
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${db}`;
  const connectionString = baseUrl.includes('supabase.co') || baseUrl.includes('pooler.supabase.com')
    ? `${baseUrl}?sslmode=no-verify`
    : baseUrl;
  return new Pool({ connectionString });
}

const pool = createPool();

export default pool;
