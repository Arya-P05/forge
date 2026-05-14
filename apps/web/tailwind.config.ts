import type { Config } from "tailwindcss"

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
      colors: {
        forge: {
          bg: "#0d0d0d",
          surface: "#141414",
          border: "#1e1e1e",
          accent: "#7c3aed",
          "accent-light": "#a78bfa",
          text: "#e2e8f0",
          muted: "#64748b",
          online: "#22c55e",
          offline: "#ef4444",
          syncing: "#f59e0b",
        },
      },
    },
  },
  plugins: [],
}

export default config
