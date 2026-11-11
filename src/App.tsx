import { useEffect, useRef, useState } from 'react'
import Peer, { type MediaConnection, type DataConnection } from 'peerjs'
import { QRCodeSVG } from 'qrcode.react'
import { monitorCall } from './monitorCall'

function Smartphone({ hostId }: { hostId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const connRef = useRef<DataConnection | null>(null)
  const [message, setMessage] = useState('ドン！')
  const [error, setError] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    const peer = new Peer()
    let call: MediaConnection | undefined
    let disposed = false

    peer.on('error', (error) => {
      setError(`接続に失敗しました：${error.message}`)
    })

    function tryCall() {
      if (!disposed && peer.open && stream && !call) {
        call = peer.call(hostId, stream)
        const conn = peer.connect(hostId)
        conn.on('open', () => {
          connRef.current = conn
          conn.send('接続完了!')
        })
        conn.on('close', () => {
          if (connRef.current == conn) {
            connRef.current = null
          }
        })
        call.on('error', (error) => {
          setError(`映像の送信に失敗しました：${error.message}`)
        })
      }
    }

    peer.on('open', () => {
      tryCall()
    })
    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('カメラを使うにはHTTPSでページを開いてください。')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })

        if (disposed || peer.destroyed) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
        tryCall()
      } catch (error) {
        if (!disposed) {
          setError(`カメラの取得に失敗しました：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    startCamera()

    function cleanup() {
      if (disposed) return
      disposed = true
      call?.close()
      stream?.getTracks().forEach((track) => track.stop())
      stream = null
      connRef.current = null
      peer.destroy()
    }

    window.addEventListener('pagehide', cleanup)
    return () => {
      window.removeEventListener('pagehide', cleanup)
      cleanup()
    }
  }, [hostId])

  return (
    <div
      onClick={() => {
        if (connRef.current && connRef.current.open) {
          connRef.current.send(message)
        }
      }}
      className="h-dvh overflow-hidden bg-blue-100 p-4"
    >
      <div className="flex flex-row items-center gap-4">
        <h1 className="mb-4 text-sm font-bold">
          スマホカメラ
        </h1>
        <p className="mb-4 break-all">
          接続先PC：{hostId}
        </p>
      </div>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        className="mb-4 rounded border bg-white p-2"
        placeholder="送信する文字"
      />

      {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full rounded bg-black"
      />
    </div>
  )
}

function App() {
  const [peerId, setPeerId] = useState('')
  const [error, setError] = useState('')
  const [videos, setVideos] = useState<
    { connectionId: string; peerId: string; stream: MediaStream }[]
  >([])
  const [effects, setEffects] = useState<
    { id: number; peerId: string; text: string; x: number; y: number }[]
  >([])
  const smartphoneUrl = `${window.location.origin}${import.meta.env.BASE_URL}?host=${peerId}`

  useEffect(() => {
    const peer = new Peer()
    const cleanups = new Set<() => void>()

    peer.on('open', (id) => {
      setPeerId(id)
    })
    peer.on('connection', (conn) => {
      conn.on('data', (data) => {
        setEffects((prev) => [
          ...prev,
          {
            id: Date.now() + Math.random(),
            peerId: conn.peer,
            text: String(data),
            x: 30 + Math.random() * 40,
            y: 10 + Math.random() * 20,
          },
        ])
      })
    })
    peer.on('error', (error) => {
      setError(`接続エラー：${error.message}`)
    })

    peer.on('call', (call) => {
      const cleanup = monitorCall(
        call,
        (stream) => {
          setVideos((prev) => [
            ...prev.filter((video) => video.connectionId !== call.connectionId),
            { connectionId: call.connectionId, peerId: call.peer, stream },
          ])
        },
        () => {
          cleanups.delete(cleanup)
          setVideos((prev) =>
            prev.filter((video) => video.connectionId !== call.connectionId),
          )
        },
      )
      cleanups.add(cleanup)
      call.answer()
    })

    return () => {
      cleanups.forEach((cleanup) => cleanup())
      peer.destroy()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="mb-4 text-2xl font-bold">
        スマホ映像モニター
      </h1>

      {error && <p role="alert" className="mb-4 text-red-700">{error}</p>}
      <p>PCのPeer ID：<span className="mt-2 break-all rounded bg-white p-4">
        {peerId || '接続待機中...'}
      </span></p>
      {peerId && (
        <div className="flex flex-row items-center gap-4">
          <div className="mt-6 inline-block rounded bg-white p-4">
            <a
              href={smartphoneUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block"
            >
              <QRCodeSVG
                value={smartphoneUrl}
                size={200}
              />
            </a>
          </div>
        </div>
      )}

      <h2 className="connection-count" aria-live="polite">
        接続中のスマホ：{videos.length}台
      </h2>

      <div className="grid grid-cols-2 items-start gap-4 md:grid-cols-3 lg:grid-cols-4">
        {videos.map((video) => (
          <VideoPanel
            key={video.connectionId}
            stream={video.stream}
            effects={effects.filter((effect) => effect.peerId === video.peerId)}
          />
        ))}
      </div>
    </div>
  )
}

function VideoPanel({
  stream,
  effects,
}: {
  stream: MediaStream
  effects: {
    id: number
    peerId: string
    text: string
    x: number
    y: number
  }[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch((err) => console.error('再生エラー:', err))
    }
  }, [stream])

  return (
    <div className="relative [container-type:inline-size]">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="w-full rounded bg-black"
      />
      {effects.map((effect) => (
        <span
          key={effect.id}
          className="pointer-events-none absolute animate-[floatUp_1s_ease-out_forwards] text-xs font-black text-white"
          style={{
            left: `${effect.x}%`,
            bottom: `${effect.y}%`,
          }}
        >
          {effect.text}
        </span>
      ))}
    </div>
  )
}

function Main() {
  const hostId = new URLSearchParams(window.location.search).get('host')
  return hostId ? <Smartphone hostId={hostId} /> : <App />
}

export default Main
