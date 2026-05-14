import { chromium } from "playwright"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dir, "../screenshots")
const URL = "http://localhost:3000"

const wait = ms => new Promise(r => setTimeout(r, ms))
const typeSlowly = async (page, text, ms = 28) => {
  for (const ch of text) { await page.keyboard.type(ch); await wait(ms) }
}

const MAIN_TS = `// Welcome to Forge — a local-first collaborative editor
// Open multiple tabs and edit together in real time.

interface User {
  id: string
  name: string
  color: string
}

const users: User[] = []

export function addUser(name: string, color: string): User {
  const user: User = { id: crypto.randomUUID(), name, color }
  users.push(user)
  return user
}

export function removeUser(id: string): void {
  const idx = users.findIndex(u => u.id === id)
  if (idx !== -1) users.splice(idx, 1)
}

export function getUser(id: string): User | null {
  return users.find(u => u.id === id) ?? null
}
`

async function loadPage(browser, name, color) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" })
  const page = await ctx.newPage()

  await page.goto(URL, { waitUntil: "domcontentloaded" })
  await page.evaluate(async () => {
    sessionStorage.clear(); localStorage.clear()
    await new Promise((res) => {
      const r = indexedDB.deleteDatabase("forge-workspace")
      r.onsuccess = r.onerror = r.onblocked = res
    })
  })
  await page.evaluate(({ name, color }) => {
    sessionStorage.setItem("forge-user", JSON.stringify({ name, color }))
  }, { name, color })

  await page.goto(URL, { waitUntil: "networkidle" })

  // Wait for Monaco to mount
  await page.waitForSelector(".monaco-editor", { timeout: 15000 })
  await wait(1500)

  return { ctx, page }
}

async function setEditorContent(page, content) {
  // Use Monaco's API directly — bypasses IDB timing entirely
  await page.evaluate((text) => {
    const editors = window.monaco?.editor?.getEditors() ?? []
    const editor = editors[0]
    if (editor) editor.getModel().setValue(text)
  }, content)
  await wait(600)
}

async function waitForContent(page) {
  await page.waitForFunction(() => {
    const lines = document.querySelectorAll(".monaco-editor .view-line")
    return lines.length > 3
  }, { timeout: 10000 }).catch(() => {})
}

;(async () => {
  const browser = await chromium.launch({ headless: true })
  console.log("loading pages…")

  const { ctx: ctxA, page: pageA } = await loadPage(browser, "alice", "#7c3aed")
  const { ctx: ctxB, page: pageB } = await loadPage(browser, "bob",   "#db2777")

  // Seed content via Monaco API on alice's page → syncs to bob via Yjs/WS
  await setEditorContent(pageA, MAIN_TS)
  await wait(2000) // let WS broadcast to bob

  // ── 1. hero: full editor with syntax-highlighted code ───────────────────
  await waitForContent(pageA)
  await pageA.screenshot({ path: `${OUT}/01-editor.png` })
  console.log("✓ 01-editor.png")

  // ── 2. bob also sees the same content (real-time sync) ───────────────────
  await waitForContent(pageB)
  await pageB.screenshot({ path: `${OUT}/02-synced.png` })
  console.log("✓ 02-synced.png")

  // ── 3. alice adds a line at the end ─────────────────────────────────────
  const editorA = pageA.locator(".monaco-editor").first()
  await editorA.click()
  await pageA.keyboard.press("Control+End")
  await wait(200)
  await pageA.keyboard.press("Enter")
  await typeSlowly(pageA, "export const VERSION = '1.0.0'")
  await wait(1200)

  // ── 4. bob types simultaneously — two live cursors ───────────────────────
  const editorB = pageB.locator(".monaco-editor").first()
  await editorB.click()
  await pageB.keyboard.press("Control+End")
  await wait(200)
  await pageB.keyboard.press("Enter")
  await typeSlowly(pageB, "export const REPO = 'github.com/Arya-P05/forge'")
  await wait(1000)

  await pageA.screenshot({ path: `${OUT}/03-live-cursors.png` })
  console.log("✓ 03-live-cursors.png")

  // ── 5. switch files to show the file tree ────────────────────────────────
  await pageB.locator("button", { hasText: "utils.ts" }).first().click()
  await wait(500)
  // set utils.ts content so it looks good
  await setEditorContent(pageB, `// Utility functions

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T, ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max)
}
`)
  await wait(800)
  await pageA.screenshot({ path: `${OUT}/04-file-tree.png` })
  console.log("✓ 04-file-tree.png")

  // ── 6. go back to main.ts and take bob offline ────────────────────────────
  await pageB.locator("button", { hasText: "main.ts" }).first().click()
  await wait(400)
  await ctxB.setOffline(true)
  await wait(2200) // status bar shows "Offline"
  await editorB.click()
  await pageB.keyboard.press("Control+End")
  await wait(200)
  await pageB.keyboard.press("Enter")
  await typeSlowly(pageB, "// bob is offline — indexeddb is saving this", 30)
  await wait(800)
  await pageB.screenshot({ path: `${OUT}/05-offline.png` })
  console.log("✓ 05-offline.png")

  // alice edits in parallel
  await editorA.click()
  await pageA.keyboard.press("Control+End")
  await wait(200)
  await pageA.keyboard.press("Enter")
  await typeSlowly(pageA, "// alice edited while bob was offline")
  await wait(600)

  // ── 7. bob reconnects, crdt merges ──────────────────────────────────────
  await ctxB.setOffline(false)
  await wait(4500)
  await pageA.screenshot({ path: `${OUT}/06-merged.png` })
  console.log("✓ 06-merged.png")

  await browser.close()
  console.log("\n✓ all screenshots saved to screenshots/")
})()
