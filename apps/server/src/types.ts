import type WebSocket from "ws"
import type * as Y from "yjs"
import type { Awareness } from "y-protocols/awareness"

export interface DocRoom {
  doc: Y.Doc
  awareness: Awareness
  clients: Map<WebSocket, ClientMeta>
}

export interface ClientMeta {
  id: string
  docName: string
}

export const MSG_SYNC = 0
export const MSG_AWARENESS = 1
export const MSG_AUTH = 2
export const MSG_QUERY_AWARENESS = 3
