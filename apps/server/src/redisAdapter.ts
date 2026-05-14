import Redis from "ioredis"
import { getRooms } from "./docManager"

let pub: Redis | null = null
let sub: Redis | null = null
let redisAvailable = false
let redisLoggedUnavailable = false

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"
const CHANNEL_PREFIX = "forge:"

export function initRedis(): void {
  const tryConnect = () => {
    const p = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null, // disable auto-retry — we handle it
      maxRetriesPerRequest: 1,
    })
    const s = new Redis(REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    })

    p.on("error", () => {
      if (redisAvailable) {
        redisAvailable = false
        console.warn("[redis] disconnected — single-instance mode")
        setTimeout(tryConnect, 5000)
      }
    })
    s.on("error", () => { /* handled by pub */ })

    Promise.all([p.connect(), s.connect()])
      .then(() => {
        pub = p
        sub = s
        redisAvailable = true
        redisLoggedUnavailable = false
        console.log("[redis] connected —", REDIS_URL)

        s.on("message", (channel: string, message: string) => {
          const docName = channel.slice(CHANNEL_PREFIX.length)
          const buf = Buffer.from(message, "binary")
          const room = getRooms().get(docName)
          if (!room) return
          for (const [ws] of room.clients) {
            const w = ws as unknown as { readyState: number; send: (d: Buffer) => void }
            if (w.readyState === 1) w.send(buf)
          }
        })
      })
      .catch(() => {
        p.disconnect()
        s.disconnect()
        if (!redisLoggedUnavailable) {
          redisLoggedUnavailable = true
          console.log("[redis] unavailable — single-instance mode (will retry silently)")
        }
        setTimeout(tryConnect, 10_000)
      })
  }

  tryConnect()
}

export async function publishUpdate(docName: string, message: Buffer | Uint8Array): Promise<void> {
  if (!pub || !redisAvailable) return
  try {
    const buf = Buffer.isBuffer(message) ? message : Buffer.from(message)
    await pub.publish(`${CHANNEL_PREFIX}${docName}`, buf as unknown as string)
  } catch {
    // local broadcast already handled
  }
}

export async function subscribeToDoc(docName: string): Promise<void> {
  if (!sub || !redisAvailable) return
  try {
    await sub.subscribe(`${CHANNEL_PREFIX}${docName}`)
  } catch {
    // ignore
  }
}
