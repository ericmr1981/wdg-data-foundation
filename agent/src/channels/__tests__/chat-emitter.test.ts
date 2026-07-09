import { test } from 'node:test'
import assert from 'node:assert'
import { ChatEmitter } from '../chat-emitter.js'

function makeFakeWs(readyState = 1 /* OPEN */) {
  const sent: string[] = []
  let closedWith: { code: number; reason: string } | null = null
  return {
    ws: {
      get readyState() { return readyState },
      send: (data: string, cb?: (e?: Error) => void) => { sent.push(data); cb?.() },
      close: (code: number, reason: string) => { closedWith = { code, reason } },
    } as any,
    sent,
    closedWith: () => closedWith,
  }
}

test('send emits JSON-serialized frame', async () => {
  const { ws, sent } = makeFakeWs()
  const emitter = new ChatEmitter(ws)
  await emitter.send({ type: 'ack', payload: { messageId: 'm1', ts: 1 } })
  assert.strictEqual(sent.length, 1)
  assert.deepStrictEqual(JSON.parse(sent[0]), { type: 'ack', payload: { messageId: 'm1', ts: 1 } })
})

test('send drops frame if ws not OPEN', async () => {
  const { ws, sent } = makeFakeWs(/* CLOSING */ 2)
  const emitter = new ChatEmitter(ws)
  await emitter.send({ type: 'ack', payload: { messageId: 'm1', ts: 1 } })
  assert.strictEqual(sent.length, 0, 'must not send to non-OPEN')
})

test('close calls ws.close with code + reason', () => {
  const { ws, closedWith } = makeFakeWs()
  const emitter = new ChatEmitter(ws)
  emitter.close(4000, 'protocol_mismatch')
  assert.deepStrictEqual(closedWith(), { code: 4000, reason: 'protocol_mismatch' })
})
