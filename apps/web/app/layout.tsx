import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Forge — Collaborative Code Editor",
  description: "Local-first collaborative code editor with CRDT sync",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-forge-bg text-forge-text antialiased">{children}</body>
    </html>
  )
}
