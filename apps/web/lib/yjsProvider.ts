"use client"

import * as Y from "yjs"
import { IndexeddbPersistence } from "y-indexeddb"
import * as awarenessProtocol from "y-protocols/awareness"
import * as syncProtocol from "y-protocols/sync"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import { USER_COLORS } from "./types"
import type { ConnectionStatus } from "./types"

const MSG_SYNC = 0
const MSG_AWARENESS = 1
const MSG_QUERY_AWARENESS = 3

const DEFAULT_FILES: Record<string, string> = {
  "main.ts": `// Welcome to Forge — collaborative code editor
// Open two tabs, edit together in real time.

interface User {
  id: string
  name: string
  cursor?: number
}

function greet(user: User): string {
  return \`Hello, \${user.name}! You are user #\${user.id}\`
}

const users: User[] = []

export function addUser(name: string): User {
  const user: User = {
    id: String(users.length + 1),
    name,
  }
  users.push(user)
  console.log(greet(user))
  return user
}
`,
  "utils.ts": `// Utility functions

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function randomColor(): string {
  const hue = Math.floor(Math.random() * 360)
  return \`hsl(\${hue}, 70%, 60%)\`
}
`,
  "types.ts": `// Shared type definitions

export type FileId = string

export interface WorkspaceFile {
  id: FileId
  name: string
  language: string
  createdAt: number
}

export interface Presence {
  userId: string
  name: string
  color: string
  cursor: CursorPosition | null
  selection: SelectionRange | null
  activeFile: FileId | null
}

export interface CursorPosition {
  line: number
  column: number
}

export interface SelectionRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}
`,
  "styles.css": `/* Global styles */

:root {
  --color-bg: #0d0d0d;
  --color-surface: #141414;
  --color-accent: #7c3aed;
  --color-text: #e2e8f0;
  --font-mono: "JetBrains Mono", Consolas, monospace;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
}
`,
  "README.md": `# Forge

A local-first collaborative code editor.

## Stack
- Yjs CRDTs
- Monaco Editor
- IndexedDB (offline)
- WebSockets + Redis Pub/Sub
`,
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234"

export interface ForgeProvider {
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  instanceId: string
  destroy: () => void
  reconnect: () => void
  onStatusChange: (cb: (status: ConnectionStatus) => void) => () => void
}

export function createForgeProvider(docName: string): ForgeProvider {
  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)

  // User identity (name + color) persists in sessionStorage so the same tab
  // keeps the same name on reload.
  const storedUser = typeof window !== "undefined"
    ? JSON.parse(sessionStorage.getItem("forge-user") || "null")
    : null

  const userName = storedUser?.name || `User ${Math.floor(Math.random() * 900 + 100)}`
  const userColor = storedUser?.color || USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]

  if (typeof window !== "undefined" && !storedUser) {
    sessionStorage.setItem("forge-user", JSON.stringify({ name: userName, color: userColor }))
  }

  // instanceId is NOT stored in sessionStorage so duplicated tabs always get a
  // fresh value. Peers filter on this to avoid showing your own cursor label
  // when you have two tabs open.
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  awareness.setLocalState({ name: userName, color: userColor, instanceId, cursor: null, selection: null, activeFile: null })

  // --- IndexedDB persistence (offline) ---
  const idbPersistence = new IndexeddbPersistence(`forge-${docName}`, doc)

  idbPersistence.on("synced", () => {
    // Seed default content only on a brand-new doc (nothing in IDB yet).
    // Doing this client-side — after IDB loads — prevents a server restart
    // from writing concurrent Y.Text inserts that collide with IDB state.
    const fileTexts = doc.getMap<Y.Text>("fileTexts")
    if (fileTexts.size === 0) {
      doc.transact(() => {
        for (const [name, content] of Object.entries(DEFAULT_FILES)) {
          fileTexts.set(name, new Y.Text(content))
        }
      }, "init")
    }
  })

  // --- Status callbacks ---
  const statusListeners = new Set<(s: ConnectionStatus) => void>()
  let currentStatus: ConnectionStatus = "connecting"

  function setStatus(s: ConnectionStatus) {
    currentStatus = s
    for (const cb of statusListeners) cb(s)
  }

  // --- WebSocket ---
  let ws: WebSocket | null = null
  let wsConnected = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  function connect() {
    if (destroyed) return
    setStatus("connecting")

    try {
      ws = new WebSocket(`${WS_URL}/sync/${docName}`)
      ws.binaryType = "arraybuffer"
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      wsConnected = true
      setStatus("connected")
      if (reconnectTimer) clearTimeout(reconnectTimer)

      // Send sync step 1
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MSG_SYNC)
      syncProtocol.writeSyncStep1(encoder, doc)
      ws!.send(encoding.toUint8Array(encoder))

      // Send local awareness
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID])
      )
      ws!.send(encoding.toUint8Array(awarenessEncoder))

      // Also query awareness from server
      const queryEncoder = encoding.createEncoder()
      encoding.writeVarUint(queryEncoder, MSG_QUERY_AWARENESS)
      ws!.send(encoding.toUint8Array(queryEncoder))
    }

    ws.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      const data = new Uint8Array(event.data)
      const decoder = decoding.createDecoder(data)
      const msgType = decoding.readVarUint(decoder)

      if (msgType === MSG_SYNC) {
        setStatus("syncing")
        const replyEncoder = encoding.createEncoder()
        encoding.writeVarUint(replyEncoder, MSG_SYNC)
        syncProtocol.readSyncMessage(decoder, replyEncoder, doc, "ws")
        if (encoding.length(replyEncoder) > 1) {
          ws?.send(encoding.toUint8Array(replyEncoder))
        }
        setTimeout(() => setStatus("connected"), 150)
      } else if (msgType === MSG_AWARENESS) {
        const update = decoding.readVarUint8Array(decoder)
        awarenessProtocol.applyAwarenessUpdate(awareness, update, "ws")
      }
    }

    ws.onclose = () => {
      wsConnected = false
      setStatus("disconnected")
      scheduleReconnect()
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function scheduleReconnect() {
    if (destroyed) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, 2000)
  }

  // Forward local doc updates to server
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === "ws" || !wsConnected || !ws) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_SYNC)
    syncProtocol.writeUpdate(encoder, update)
    ws.send(encoding.toUint8Array(encoder))
  })

  // Forward local awareness to server
  awareness.on("update", ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = [...added, ...updated, ...removed]
    if (!wsConnected || !ws) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MSG_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    )
    ws.send(encoding.toUint8Array(encoder))
  })

  connect()

  return {
    doc,
    awareness,
    instanceId,
    reconnect: () => {
      ws?.close()
      connect()
    },
    destroy: () => {
      destroyed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      awareness.destroy()
      idbPersistence.destroy()
      ws?.close()
    },
    onStatusChange: (cb) => {
      statusListeners.add(cb)
      cb(currentStatus)
      return () => statusListeners.delete(cb)
    },
  }
}
