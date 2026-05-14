export interface FileEntry {
  name: string
  language: string
}

export interface UserPresence {
  clientId: number
  name: string
  color: string
  cursor: { lineNumber: number; column: number } | null
  selection: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  } | null
  activeFile: string | null
}

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "syncing"

export const WORKSPACE_FILES: FileEntry[] = [
  { name: "main.ts", language: "typescript" },
  { name: "utils.ts", language: "typescript" },
  { name: "types.ts", language: "typescript" },
  { name: "styles.css", language: "css" },
  { name: "README.md", language: "markdown" },
]

export const USER_COLORS = [
  "#7c3aed", "#db2777", "#ea580c", "#16a34a",
  "#0891b2", "#9333ea", "#e11d48", "#d97706",
]

export function getLanguageIcon(lang: string): string {
  const icons: Record<string, string> = {
    typescript: "TS",
    javascript: "JS",
    css: "CSS",
    markdown: "MD",
    json: "{}",
    html: "HTML",
  }
  return icons[lang] || lang.slice(0, 3).toUpperCase()
}
