// agent/src/channels/cron.test.ts
import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import { CronChannel } from './cron.ts'

test('CronChannel can be started and stopped', async () => {
  const manager = { onIncoming: async (_m: any) => { /* noop */ } }
  const ch = new CronChannel(manager as any, 'Asia/Shanghai')
  await ch.start()
  assert.equal((ch as any).tasks.length, 1)
  await ch.stop()
  assert.ok(true)
})
