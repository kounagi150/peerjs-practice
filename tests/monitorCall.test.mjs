import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { monitorCall, DISCONNECT_TIMEOUT_MS } from '../src/monitorCall.ts'

class Call extends EventEmitter {
  closeCount = 0
  close() {
    this.closeCount++
    this.emit('close')
  }
}

function setup() {
  const call = new Call()
  const streams = []
  let removals = 0
  const cleanup = monitorCall(call, (stream) => streams.push(stream), () => removals++)
  return { call, streams, cleanup, get removals() { return removals } }
}

for (const state of ['failed', 'closed']) {
  test(`${state}: 対象の映像を一度だけ削除し、監視を解除する`, () => {
    const target = setup()
    target.call.emit('stream', { id: 'camera' })
    target.call.emit('iceStateChanged', state)
    target.cleanup()
    target.call.emit('stream', { id: 'late' })
    assert.equal(target.removals, 1)
    assert.equal(target.call.closeCount, 1)
    assert.equal(target.streams.length, 1)
    assert.equal(target.call.eventNames().length, 0)
  })
}

test('一時切断が継続したら15秒後に削除する。重複通知で期限を延ばさない', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const target = setup()
  target.call.emit('iceStateChanged', 'disconnected')
  t.mock.timers.tick(DISCONNECT_TIMEOUT_MS - 1)
  assert.equal(target.removals, 0)
  target.call.emit('iceStateChanged', 'disconnected')
  t.mock.timers.tick(1)
  assert.equal(target.removals, 1)
})

test('復旧した接続を削除せず、再切断時は新たに猶予を設ける', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const target = setup()
  target.call.emit('iceStateChanged', 'disconnected')
  t.mock.timers.tick(10_000)
  target.call.emit('iceStateChanged', 'connected')
  t.mock.timers.tick(DISCONNECT_TIMEOUT_MS)
  assert.equal(target.removals, 0)
  target.call.emit('iceStateChanged', 'disconnected')
  t.mock.timers.tick(DISCONNECT_TIMEOUT_MS)
  assert.equal(target.removals, 1)
})

for (const event of ['close', 'error']) {
  test(`${event}: 映像到着前でも接続を片付ける`, () => {
    const target = setup()
    target.call.emit(event)
    assert.equal(target.removals, 1)
    assert.equal(target.call.eventNames().length, 0)
  })
}

test('一台の切断が別の接続に影響しない', () => {
  const first = setup()
  const second = setup()
  first.call.emit('close')
  second.call.emit('stream', { id: 'second' })
  assert.equal(first.removals, 1)
  assert.equal(second.removals, 0)
  assert.equal(second.streams.length, 1)
  second.cleanup()
})

test('画面終了時に残ったタイマーとイベントを解除する', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const target = setup()
  target.call.emit('iceStateChanged', 'disconnected')
  target.cleanup()
  t.mock.timers.tick(DISCONNECT_TIMEOUT_MS)
  assert.equal(target.removals, 1)
  assert.equal(target.call.eventNames().length, 0)
})
