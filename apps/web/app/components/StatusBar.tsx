"use client"

import { useState, useEffect } from "react"
import type { ConnectionStatus, UserPresence } from "../../lib/types"

interface Props {
  status: ConnectionStatus
  peers: UserPresence[]
  fileName: string
  onReconnect: () => void
}

const STATUS_CONFIG = {
  connected: { label: "Connected", dot: "bg-forge-online", pulse: false },
  connecting: { label: "Connecting...", dot: "bg-forge-syncing", pulse: true },
  syncing: { label: "Syncing", dot: "bg-forge-syncing", pulse: true },
  disconnected: { label: "Offline", dot: "bg-forge-offline", pulse: false },
}

export default function StatusBar({ status, peers, fileName, onReconnect }: Props) {
  const [latency, setLatency] = useState<number | null>(null)

  useEffect(() => {
    if (status !== "connected") {
      setLatency(null)
      return
    }

    // Measure round-trip latency via a small ping
    let active = true
    const measure = () => {
      if (!active || status !== "connected") return
      const t = Date.now()
      // We approximate with a fetch to the server health endpoint
      fetch(`${process.env.NEXT_PUBLIC_WS_URL?.replace("ws://", "http://") || "http://localhost:1234"}/health`)
        .then(() => { if (active) setLatency(Date.now() - t) })
        .catch(() => { if (active) setLatency(null) })
    }

    measure()
    const interval = setInterval(measure, 3000)
    return () => { active = false; clearInterval(interval) }
  }, [status])

  const cfg = STATUS_CONFIG[status]

  return (
    <div className="h-6 bg-forge-surface border-t border-forge-border flex items-center px-3 gap-4 text-[11px] text-forge-muted select-none">
      {/* Connection status */}
      <button
        onClick={status === "disconnected" ? onReconnect : undefined}
        className={`flex items-center gap-1.5 ${status === "disconnected" ? "hover:text-forge-text cursor-pointer" : "cursor-default"}`}
        title={status === "disconnected" ? "Click to reconnect" : undefined}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} ${cfg.pulse ? "animate-pulse" : ""}`} />
        <span>{cfg.label}</span>
        {status === "disconnected" && (
          <span className="text-forge-accent-light">(click to reconnect)</span>
        )}
      </button>

      <span className="text-forge-border">|</span>

      {/* Active file */}
      <span className="text-forge-text/70">{fileName}</span>

      <span className="text-forge-border">|</span>

      {/* Peers */}
      <div className="flex items-center gap-1.5">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>{peers.length + 1} user{peers.length !== 0 ? "s" : ""}</span>
      </div>

      {/* Latency */}
      {latency !== null && (
        <>
          <span className="text-forge-border">|</span>
          <span className={latency < 50 ? "text-forge-online" : latency < 150 ? "text-forge-syncing" : "text-forge-offline"}>
            {latency}ms
          </span>
        </>
      )}

      {/* Offline indicator */}
      {status === "disconnected" && (
        <>
          <span className="text-forge-border">|</span>
          <span className="text-forge-syncing flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Edits saved locally
          </span>
        </>
      )}

      <div className="flex-1" />

      {/* Forge branding */}
      <span className="text-forge-accent-light font-semibold tracking-wide">
        ⚡ Forge
      </span>
    </div>
  )
}
