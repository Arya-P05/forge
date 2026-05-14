"use client"

import { useEffect, useRef, useCallback } from "react"
import MonacoEditor, { type OnMount } from "@monaco-editor/react"
import type * as MonacoType from "monaco-editor"
import * as Y from "yjs"
import * as awarenessProtocol from "y-protocols/awareness"
import type { UserPresence } from "../../lib/types"

interface Props {
  yText: Y.Text
  awareness: awarenessProtocol.Awareness
  language: string
  fileName: string
  peers: UserPresence[]
}

// Stable set of decorations per client
const peerDecorations = new Map<number, string[]>()

export default function Editor({ yText, awareness, language, fileName, peers }: Props) {
  const editorRef = useRef<MonacoType.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof MonacoType | null>(null)
  const bindingActiveRef = useRef(false)
  const suppressMonacoRef = useRef(false)

  // Apply Y.Text delta to Monaco
  const applyYjsDelta = useCallback((event: Y.YTextEvent, transaction: Y.Transaction) => {
    // Skip changes that originated here — Monaco already has them
    if (transaction.origin === "monaco") return

    const editor = editorRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return

    suppressMonacoRef.current = true
    try {
      // oldIndex = position in the PRE-CHANGE model.
      // Retain advances it (those chars exist in both old and new).
      // Insert does NOT advance it (new chars don't exist in the old model).
      // Delete advances it (those chars exist in old, are being removed).
      // All edits reference the original model so pushEditOperations can apply
      // them atomically without re-computing offsets after each op.
      let oldIndex = 0
      const edits: MonacoType.editor.IIdentifiedSingleEditOperation[] = []

      for (const op of event.delta) {
        if (op.retain) {
          oldIndex += op.retain
        } else if (op.insert && typeof op.insert === "string") {
          const pos = model.getPositionAt(oldIndex)
          edits.push({
            range: new monacoRef.current!.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: op.insert,
            forceMoveMarkers: true,
          })
          // oldIndex intentionally NOT advanced — inserts don't exist in old model
        } else if (op.delete) {
          const startPos = model.getPositionAt(oldIndex)
          const endPos = model.getPositionAt(oldIndex + op.delete)
          edits.push({
            range: new monacoRef.current!.Range(
              startPos.lineNumber, startPos.column,
              endPos.lineNumber, endPos.column,
            ),
            text: "",
            forceMoveMarkers: true,
          })
          oldIndex += op.delete
        }
      }

      if (edits.length > 0) {
        model.pushEditOperations([], edits, () => null)
      }
    } finally {
      suppressMonacoRef.current = false
    }
  }, [])

  const handleMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    bindingActiveRef.current = true

    // Sync initial content from Y.Text -> Monaco
    const initial = yText.toString()
    const model = editor.getModel()
    if (model && model.getValue() !== initial) {
      model.setValue(initial)
    }

    // Y.Text -> Monaco (remote edits)
    yText.observe(applyYjsDelta)

    // Monaco -> Y.Text (local edits)
    editor.onDidChangeModelContent((e) => {
      if (suppressMonacoRef.current) return
      const model = editor.getModel()
      if (!model) return

      yText.doc?.transact(() => {
        for (const change of [...e.changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
          if (change.rangeLength > 0) yText.delete(change.rangeOffset, change.rangeLength)
          if (change.text) yText.insert(change.rangeOffset, change.text)
        }
      }, "monaco")
    })

    // Cursor -> awareness
    editor.onDidChangeCursorPosition((e) => {
      const model = editor.getModel()
      if (!model) return
      awareness.setLocalStateField("cursor", {
        lineNumber: e.position.lineNumber,
        column: e.position.column,
      })
    })

    // Selection -> awareness
    editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection
      if (sel.isEmpty()) {
        awareness.setLocalStateField("selection", null)
      } else {
        awareness.setLocalStateField("selection", {
          startLineNumber: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLineNumber: sel.endLineNumber,
          endColumn: sel.endColumn,
        })
      }
    })

    return () => {
      yText.unobserve(applyYjsDelta)
      bindingActiveRef.current = false
    }
  }, [yText, awareness, applyYjsDelta])

  // Render peer cursors/selections as Monaco decorations
  useEffect(() => {
    const editor = editorRef.current
    const monaco = monacoRef.current
    if (!editor || !monaco) return

    // Clear old decorations for peers that are gone
    const activePeerIds = new Set(peers.map((p) => p.clientId))
    for (const [clientId, decorIds] of peerDecorations) {
      if (!activePeerIds.has(clientId)) {
        editor.deltaDecorations(decorIds, [])
        peerDecorations.delete(clientId)
      }
    }

    for (const peer of peers) {
      const decorations: MonacoType.editor.IModelDeltaDecoration[] = []

      if (peer.selection) {
        const { startLineNumber, startColumn, endLineNumber, endColumn } = peer.selection
        decorations.push({
          range: new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn),
          options: {
            className: undefined,
            inlineClassName: undefined,
            // Use after/before content to show a colored selection
            isWholeLine: false,
          },
        })
        // Selection highlight
        decorations.push({
          range: new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn),
          options: {
            className: `peer-selection-${peer.clientId}`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }

      if (peer.cursor) {
        const { lineNumber, column } = peer.cursor
        decorations.push({
          range: new monaco.Range(lineNumber, column, lineNumber, column),
          options: {
            className: `peer-cursor-${peer.clientId}`,
            afterContentClassName: `peer-cursor-caret-${peer.clientId}`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }

      const prev = peerDecorations.get(peer.clientId) || []
      const next = editor.deltaDecorations(prev, decorations)
      peerDecorations.set(peer.clientId, next)
    }
  }, [peers])

  // Inject dynamic CSS for peer cursors
  useEffect(() => {
    const styleId = "forge-peer-styles"
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement("style")
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    const rules = peers
      .map((peer) => {
        const color = peer.color
        return `
          .peer-selection-${peer.clientId} { background: ${color}33 !important; border-radius: 2px; }
          .peer-cursor-caret-${peer.clientId}::after {
            content: "${peer.name.replace(/"/g, "")}";
            position: absolute;
            top: -18px;
            left: 0;
            background: ${color};
            color: #fff;
            font-size: 10px;
            font-family: system-ui, sans-serif;
            padding: 1px 5px;
            border-radius: 3px;
            white-space: nowrap;
            pointer-events: none;
            z-index: 100;
          }
          .peer-cursor-${peer.clientId} { border-left: 2px solid ${color}; margin-left: -1px; }
        `
      })
      .join("\n")

    styleEl.textContent = rules
  }, [peers])

  // When file changes, rebind Y.Text observer and reset content
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return

    yText.unobserve(applyYjsDelta)

    suppressMonacoRef.current = true
    const model = editor.getModel()
    if (model) {
      const current = yText.toString()
      if (model.getValue() !== current) model.setValue(current)
    }
    suppressMonacoRef.current = false

    yText.observe(applyYjsDelta)

    return () => {
      yText.unobserve(applyYjsDelta)
    }
  }, [yText, fileName, applyYjsDelta])

  return (
    <MonacoEditor
      key={fileName}
      height="100%"
      language={language}
      theme="vs-dark"
      onMount={handleMount}
      options={{
        fontSize: 14,
        fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
        fontLigatures: true,
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        renderLineHighlight: "gutter",
        cursorBlinking: "smooth",
        smoothScrolling: true,
        padding: { top: 16 },
        lineNumbers: "on",
        wordWrap: "off",
        tabSize: 2,
        automaticLayout: true,
      }}
    />
  )
}
