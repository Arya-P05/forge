import dynamic from "next/dynamic"

// Workspace is entirely client-side (WebSockets, Monaco, IndexedDB)
const Workspace = dynamic(() => import("./components/Workspace"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-screen bg-[#0d0d0d] text-[#e2e8f0]">
      <div className="flex flex-col items-center gap-4">
        <div className="text-5xl">⚡</div>
        <div className="text-xl font-semibold tracking-wide">Forge</div>
        <div className="text-sm text-[#64748b]">Loading collaborative workspace...</div>
        <div className="w-32 h-0.5 bg-[#1e1e1e] rounded overflow-hidden mt-2">
          <div className="h-full bg-[#7c3aed] animate-[progress_1.5s_ease-in-out_infinite]" />
        </div>
      </div>
    </div>
  ),
})

export default function Home() {
  return <Workspace />
}
