import { Pool } from 'pg';

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
