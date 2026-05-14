import http from "http"
import { WebSocketServer, WebSocket } from "ws"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { getOrCreateRoom, removeClientFromRoom } from "./docManager"
import { initRedis, publishUpdate, subscribeToDoc } from "./redisAdapter"
import { MSG_SYNC, MSG_AWARENESS, MSG_QUERY_AWARENESS } from "./types"

const PORT = Number(process.env.PORT || 1234)

initRedis()

// Bare HTTP server for health + CORS (WebSocket upgrades handled by wss)
const httpServer = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ status: "ok", ts: Date.now() }))
  } else {
    res.writeHead(426, { "Content-Type": "text/plain" })
    res.end("Upgrade Required")
  }
})

const wss = new WebSocketServer({ server: httpServer })

wss.on("connection", (ws: WebSocket, req) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`)
  // doc name comes from the URL path: /sync/workspace
  const docName = url.pathname.replace(/^\/sync\//, "") || "workspace"

  const room = getOrCreateRoom(docName)
  const clientId = Math.random().toString(36).slice(2)
  room.clients.set(ws, { id: clientId, docName })

  subscribeToDoc(docName)

  // --- Step 1: send sync state vector to client ---
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MSG_SYNC)
  syncProtocol.writeSyncStep1(encoder, room.doc)
  ws.send(encoding.toUint8Array(encoder))

  // --- Send current awareness states ---
  const awarenessStates = room.awareness.getStates()
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder()
    encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(awarenessStates.keys())
      )
    )
    ws.send(encoding.toUint8Array(awarenessEncoder))
  }

  ws.on("message", (data: Buffer) => {
    try {
      const decoder = decoding.createDecoder(data)
      const msgType = decoding.readVarUint(decoder)

      if (msgType === MSG_SYNC) {
        const syncEncoder = encoding.createEncoder()
        encoding.writeVarUint(syncEncoder, MSG_SYNC)
        const syncMsgType = syncProtocol.readSyncMessage(
          decoder,
          syncEncoder,
          room.doc,
          ws
        )

        // If step2 or update, broadcast to other local clients and Redis
        if (syncMsgType === syncProtocol.messageYjsSyncStep2 || syncMsgType === syncProtocol.messageYjsUpdate) {
          broadcastToRoom(docName, data, ws)
          publishUpdate(docName, Buffer.from(data))
        }

        // Reply if we have something to send (sync step 2)
        if (encoding.length(syncEncoder) > 1) {
          ws.send(encoding.toUint8Array(syncEncoder))
        }
      } else if (msgType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws)
        // Broadcast awareness to all other local clients and Redis
        const fwdEncoder = encoding.createEncoder()
        encoding.writeVarUint(fwdEncoder, MSG_AWARENESS)
        encoding.writeVarUint8Array(fwdEncoder, update)
        const msg = Buffer.from(encoding.toUint8Array(fwdEncoder))
        broadcastToRoom(docName, msg, ws)
        publishUpdate(docName, msg)
      } else if (msgType === MSG_QUERY_AWARENESS) {
        const awarenessEncoder = encoding.createEncoder()
        encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS)
        encoding.writeVarUint8Array(
          awarenessEncoder,
          awarenessProtocol.encodeAwarenessUpdate(
            room.awareness,
            Array.from(room.awareness.getStates().keys())
          )
        )
        ws.send(encoding.toUint8Array(awarenessEncoder))
      }
    } catch (e) {
      console.error("[ws] message error:", e)
    }
  })

  ws.on("close", () => {
    const room = getOrCreateRoom(docName)
    const clientEntry = room.clients.get(ws)
    if (clientEntry) {
      // Remove this client's awareness
      awarenessProtocol.removeAwarenessStates(
        room.awareness,
        [room.doc.clientID],
        "close"
      )
    }
    removeClientFromRoom(docName, ws as unknown as Parameters<typeof removeClientFromRoom>[1])
  })

  ws.on("error", (e) => {
    console.warn("[ws] client error:", e.message)
  })
})

function broadcastToRoom(docName: string, message: Buffer | Uint8Array, exclude: WebSocket): void {
  const room = getOrCreateRoom(docName)
  for (const [client] of room.clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}

httpServer.listen(PORT, () => {
  console.log(`[forge] server on http://localhost:${PORT}  ws://localhost:${PORT}`)
})

httpServer.on("error", (e) => {
  console.error("[forge] server error:", e)
  process.exit(1)
})

// Graceful shutdown
process.on("SIGTERM", () => {
  wss.close(() => process.exit(0))
})
