import type { MediaConnection } from 'peerjs'

// 一時的な通信断は復旧を待ち、継続する場合だけ一覧から取り除く。
export const DISCONNECT_TIMEOUT_MS = 15_000

export function monitorCall(
  call: MediaConnection,
  onStream: (stream: MediaStream) => void,
  onRemove: () => void,
) {
  let finished = false
  let timer: ReturnType<typeof setTimeout> | undefined

  function clearTimer() {
    clearTimeout(timer)
    timer = undefined
  }

  function finish() {
    if (finished) return
    finished = true
    clearTimer()
    call.off('stream', receiveStream)
    call.off('iceStateChanged', checkState)
    call.off('close', finish)
    call.off('error', finish)
    onRemove()
    call.close()
  }

  function checkState(state: RTCIceConnectionState) {
    if (state === 'failed' || state === 'closed') {
      finish()
    } else if (state === 'disconnected') {
      if (timer === undefined) timer = setTimeout(finish, DISCONNECT_TIMEOUT_MS)
    } else {
      clearTimer()
    }
  }

  function receiveStream(stream: MediaStream) {
    if (!finished) onStream(stream)
  }

  call.on('stream', receiveStream)
  call.on('iceStateChanged', checkState)
  call.on('close', finish)
  call.on('error', finish)
  return finish
}
