import { Pool } from 'pg';

function createPool(): Pool {
  if (!process.env.DB_PASSWORD && !process.env.DATABASE_URL) {
    return new Pool({ connectionString: 'postgresql://localhost/dataplatform' });
  }
  return new Pool({
    connectionString: process.env.DATABASE_URL ||
      `postgresql://${process.env.DB_USER || 'postgres'}:${process.env.DB_PASSWORD}@${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'dataplatform'}`,
  });
}

const pool = createPool();

export default pool;
