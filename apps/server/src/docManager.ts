import * as Y from "yjs"
import * as awarenessProtocol from "y-protocols/awareness"

import type { DocRoom } from "./types"

// In-memory store of live documents
const rooms = new Map<string, DocRoom>()

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
  "styles.css": `/* Global styles for the application */

:root {
  --color-bg: #0d0d0d;
  --color-surface: #141414;
  --color-border: #1e1e1e;
  --color-accent: #7c3aed;
  --color-text: #e2e8f0;
  --color-muted: #64748b;
  --font-mono: "JetBrains Mono", "Fira Code", Consolas, monospace;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-mono);
  height: 100vh;
  overflow: hidden;
}

.editor-container {
  display: flex;
  height: 100vh;
}
`,
  "README.md": `# Forge

A local-first collaborative code editor built with:

- **Yjs** — CRDT-based real-time sync
- **Monaco Editor** — VS Code editing engine
- **IndexedDB** — offline persistence
- **WebSockets** — real-time transport
- **Redis Pub/Sub** — horizontal scaling

## Features

- Real-time multiplayer editing
- Offline mode with automatic conflict resolution
- Live cursors and user presence
- File tree with syntax highlighting
- Works across multiple server instances

## Demo

1. Open two browser windows side by side
2. Edit the same file in both — changes sync instantly
3. Go offline (DevTools → Network → Offline)
4. Keep editing — changes persist in IndexedDB
5. Reconnect — edits merge automatically, nothing lost
`,
}

export function getOrCreateRoom(docName: string): DocRoom {
  if (rooms.has(docName)) return rooms.get(docName)!

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)

  // Server starts with an empty doc — clients seed default content via IDB on
  // first visit. This prevents the server's fresh-state from colliding with
  // existing IDB state and producing CRDT merge artifacts (interleaved/reversed text).

  const room: DocRoom = {
    doc,
    awareness,
    clients: new Map(),
  }

  rooms.set(docName, room)
  return room
}

export function removeClientFromRoom(docName: string, ws: WebSocket): void {
  const room = rooms.get(docName)
  if (!room) return

  const meta = room.clients.get(ws as unknown as import("ws").WebSocket)
  if (meta) {
    awarenessProtocol.removeAwarenessStates(room.awareness, [room.doc.clientID], "disconnect")
  }
  room.clients.delete(ws as unknown as import("ws").WebSocket)

  // Clean up empty rooms after a delay (allow reconnects)
  if (room.clients.size === 0) {
    setTimeout(() => {
      const r = rooms.get(docName)
      if (r && r.clients.size === 0) {
        rooms.delete(docName)
      }
    }, 30_000)
  }
}

export function getRooms(): Map<string, DocRoom> {
  return rooms
}
