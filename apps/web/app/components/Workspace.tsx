"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import dynamic from "next/dynamic"
import * as Y from "yjs"
import * as awarenessProtocol from "y-protocols/awareness"
import { createForgeProvider, type ForgeProvider } from "../../lib/yjsProvider"
import { WORKSPACE_FILES, type UserPresence, type ConnectionStatus } from "../../lib/types"
import FileTree from "./FileTree"
import PresenceBar from "./PresenceBar"
import StatusBar from "./StatusBar"

// Monaco must be client-only (no SSR)
const Editor = dynamic(() => import("./Editor"), { ssr: false })

export default function Workspace() {
  const providerRef = useRef<ForgeProvider | null>(null)
  const [doc, setDoc] = useState<Y.Doc | null>(null)
  const [awareness, setAwareness] = useState<awarenessProtocol.Awareness | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>("connecting")
  const [peers, setPeers] = useState<UserPresence[]>([])
  const [activeFile, setActiveFile] = useState("main.ts")
  const [localUser, setLocalUser] = useState({ name: "You", color: "#7c3aed" })
  const [yTextMap, setYTextMap] = useState<Map<string, Y.Text>>(new Map())

  useEffect(() => {
    const provider = createForgeProvider("workspace")
    providerRef.current = provider
    setDoc(provider.doc)
    setAwareness(provider.awareness)

    // Load local user identity
    const stored = typeof window !== "undefined"
      ? JSON.parse(sessionStorage.getItem("forge-user") || "null")
      : null
    if (stored) setLocalUser(stored)

    // Build Y.Text map from the doc's fileTexts
    const buildTextMap = () => {
      const fileTexts = provider.doc.getMap<Y.Text>("fileTexts")
      const map = new Map<string, Y.Text>()
      for (const file of WORKSPACE_FILES) {
        let ytext = fileTexts.get(file.name)
        if (!ytext) {
          ytext = new Y.Text()
          provider.doc.transact(() => {
            fileTexts.set(file.name, ytext!)
          })
        }
        map.set(file.name, ytext)
      }
      setYTextMap(map)
    }

    // Build immediately and after IDB sync
    buildTextMap()
    provider.doc.on("update", buildTextMap)

    // Status subscription
    const unsubStatus = provider.onStatusChange(setStatus)

    // Awareness subscription
    const localInstanceId = provider.instanceId
    const updatePeers = () => {
      const states = provider.awareness.getStates()
      const peerList: UserPresence[] = []
      for (const [clientId, state] of states) {
        if (clientId === provider.doc.clientID) continue   // same tab
        if (state?.instanceId === localInstanceId) continue // duplicate tab
        if (!state?.name) continue
        peerList.push({
          clientId,
          name: state.name,
          color: state.color || "#6b7280",
          cursor: state.cursor || null,
          selection: state.selection || null,
          activeFile: state.activeFile || null,
        })
      }
      setPeers(peerList)
    }

    provider.awareness.on("change", updatePeers)
    updatePeers()

    return () => {
      provider.doc.off("update", buildTextMap)
      provider.awareness.off("change", updatePeers)
      unsubStatus()
      provider.destroy()
      providerRef.current = null
    }
  }, [])

  // Broadcast active file to peers
  const handleFileSelect = useCallback((name: string) => {
    setActiveFile(name)
    providerRef.current?.awareness.setLocalStateField("activeFile", name)
  }, [])

  const handleReconnect = useCallback(() => {
    providerRef.current?.reconnect()
  }, [])

  const activeFileEntry = WORKSPACE_FILES.find((f) => f.name === activeFile) || WORKSPACE_FILES[0]
  const activeYText = yTextMap.get(activeFile)

  return (
    <div className="flex flex-col h-screen bg-forge-bg text-forge-text overflow-hidden">
      {/* Top bar */}
      <PresenceBar
        localName={localUser.name}
        localColor={localUser.color}
        peers={peers}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-52 flex-shrink-0 bg-forge-surface border-r border-forge-border overflow-hidden">
          <FileTree
            files={WORKSPACE_FILES}
            activeFile={activeFile}
            onSelect={handleFileSelect}
            peers={peers}
          />
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-hidden relative">
          {/* Tab bar */}
          <div className="flex items-center h-9 bg-forge-surface border-b border-forge-border overflow-x-auto">
            {WORKSPACE_FILES.map((file) => (
              <button
                key={file.name}
                onClick={() => handleFileSelect(file.name)}
                className={`flex items-center gap-2 px-4 h-full text-sm border-r border-forge-border whitespace-nowrap transition-colors flex-shrink-0 ${
                  file.name === activeFile
                    ? "bg-forge-bg text-forge-text border-t-2 border-t-forge-accent"
                    : "text-forge-muted hover:text-forge-text hover:bg-forge-bg/50"
                }`}
              >
                <span>{file.name}</span>
                {/* Peer dot on tab */}
                {peers.some((p) => p.activeFile === file.name) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-forge-online" />
                )}
              </button>
            ))}
          </div>

          {/* Monaco editor */}
          <div className="absolute inset-0 top-9">
            {awareness && activeYText ? (
              <Editor
                key={activeFile}
                yText={activeYText}
                awareness={awareness}
                language={activeFileEntry.language}
                fileName={activeFile}
                peers={peers.filter((p) => p.activeFile === activeFile || !p.activeFile)}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-forge-muted">
                <div className="text-center space-y-2">
                  <div className="text-2xl">⚡</div>
                  <div className="text-sm">Loading workspace...</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        status={status}
        peers={peers}
        fileName={activeFile}
        onReconnect={handleReconnect}
      />
    </div>
  )
}
