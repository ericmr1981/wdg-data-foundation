// agent/src/db.ts
// Singleton pg.Pool + 关闭 helper
// Service 进程里 getPool() 全局共享,max=10 足够 LLM + 内部 task 调度并发

import pg from 'pg'

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL not set')
    pool = new Pool({ connectionString: url, max: 10 })
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}
