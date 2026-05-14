"use client"

import type { FileEntry, UserPresence } from "../../lib/types"
import { getLanguageIcon } from "../../lib/types"

interface Props {
  files: FileEntry[]
  activeFile: string
  onSelect: (name: string) => void
  peers: UserPresence[]
}

const LANG_COLORS: Record<string, string> = {
  typescript: "#3b82f6",
  javascript: "#f59e0b",
  css: "#a78bfa",
  markdown: "#6b7280",
  json: "#10b981",
}

export default function FileTree({ files, activeFile, onSelect, peers }: Props) {
  const peersByFile = new Map<string, UserPresence[]>()
  for (const peer of peers) {
    if (peer.activeFile) {
      const list = peersByFile.get(peer.activeFile) || []
      list.push(peer)
      peersByFile.set(peer.activeFile, list)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-forge-border">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-forge-muted">
          Explorer
        </span>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        <div className="px-2 py-1">
          <div className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-forge-muted uppercase tracking-wider">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            Workspace
          </div>

          <div className="mt-1 space-y-0.5">
            {files.map((file) => {
              const isActive = file.name === activeFile
              const filePeers = peersByFile.get(file.name) || []
              const color = LANG_COLORS[file.language] || "#6b7280"

              return (
                <button
                  key={file.name}
                  onClick={() => onSelect(file.name)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left group transition-colors ${
                    isActive
                      ? "bg-forge-accent/20 text-forge-accent-light"
                      : "text-forge-text hover:bg-white/5"
                  }`}
                >
                  {/* Language badge */}
                  <span
                    className="text-[9px] font-bold w-6 flex-shrink-0 text-center"
                    style={{ color }}
                  >
                    {getLanguageIcon(file.language)}
                  </span>

                  {/* File name */}
                  <span className="flex-1 truncate">{file.name}</span>

                  {/* Peer dots */}
                  {filePeers.length > 0 && (
                    <div className="flex -space-x-1 flex-shrink-0">
                      {filePeers.slice(0, 3).map((peer) => (
                        <div
                          key={peer.clientId}
                          className="w-3 h-3 rounded-full border border-forge-surface flex-shrink-0"
                          style={{ background: peer.color }}
                          title={peer.name}
                        />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
