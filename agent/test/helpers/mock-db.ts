// agent/test/helpers/mock-db.ts
// In-memory pg.Pool for unit/integration tests
// 用 pg-mem 加载 sql/00_agent_schema.sql,跑完 DDL 即可 query/insert
// TRUNCATE 用 CASCADE 清掉 FK 关联行

import { newDb, IMemoryDb } from 'pg-mem'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

let memDb: IMemoryDb

export async function createTestDb() {
  memDb = newDb({ autoCreateForeignKeyIndices: true })

  // pg-mem 默认不实现 pgcrypto 扩展,手动注册 gen_random_uuid()
  // DataType 枚举从 pg-mem public 类型导出
  const { DataType } = await import('pg-mem')
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.uuid,
    implementation: () => crypto.randomUUID(),
  })

  const pg = memDb.adapters.createPg()
  const pool = new pg.Pool()

  // 跑 DDL — 从仓库根相对路径,跨 cwd 安全
  //   agent/test/helpers/mock-db.ts → ../../../sql/00_agent_schema.sql
  const here = dirname(fileURLToPath(import.meta.url))
  const ddlPath = join(here, '..', '..', '..', 'sql', '00_agent_schema.sql')
  const rawDdl = readFileSync(ddlPath, 'utf-8')

  // pg-mem 不真正实现 CREATE SCHEMA — 所有表都进 public
  // 测试里把 agent. 前缀剥掉,让表落在 public;cleanup 也对应调整
  const ddl = rawDdl.replace(/CREATE SCHEMA IF NOT EXISTS agent;?/g, '')
                     .replace(/agent\./g, '')
  await pool.query(ddl)

  return pool
}

export async function cleanupTestDb(pool: any) {
  await pool.query(`TRUNCATE conversations, messages, tasks, task_steps, audit_log CASCADE`)
}
