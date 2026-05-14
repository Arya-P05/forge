"use client"

import type { UserPresence } from "../../lib/types"

interface Props {
  localName: string
  localColor: string
  peers: UserPresence[]
}

export default function PresenceBar({ localName, localColor, peers }: Props) {
  const allUsers = [
    { name: localName, color: localColor, isLocal: true, clientId: -1 },
    ...peers.map((p) => ({ ...p, isLocal: false })),
  ]

  return (
    <div className="flex items-center gap-2 px-3 h-9 border-b border-forge-border bg-forge-surface">
      {/* Logo */}
      <span className="text-forge-accent-light font-bold text-sm mr-2">forge</span>
      <div className="w-px h-4 bg-forge-border" />

      {/* User avatars */}
      <div className="flex items-center gap-1.5">
        {allUsers.map((user, i) => (
          <div
            key={i}
            className="relative group"
            title={user.isLocal ? `${user.name} (you)` : user.name}
          >
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 border-forge-bg cursor-default"
              style={{ background: user.color }}
            >
              {user.name[0]?.toUpperCase()}
            </div>
            {user.isLocal && (
              <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-forge-online border border-forge-bg" />
            )}
            {/* Tooltip */}
            <div className="absolute top-8 left-1/2 -translate-x-1/2 bg-forge-surface border border-forge-border rounded px-2 py-1 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity">
              {user.name}{user.isLocal ? " (you)" : ""}
            </div>
          </div>
        ))}
      </div>

      {peers.length === 0 && (
        <span className="text-forge-muted text-xs ml-1">
          Open another tab to collaborate
        </span>
      )}

      <div className="flex-1" />

      {/* Keyboard hints */}
      <div className="hidden md:flex items-center gap-3 text-[11px] text-forge-muted">
        <span>Go offline: DevTools → Network → Offline</span>
      </div>
    </div>
  )
}
