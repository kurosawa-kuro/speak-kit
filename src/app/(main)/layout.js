import { AiCost } from "../_components/ai-cost"
import { Tabs } from "../_components/tabs"

export default function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-3 sm:px-6 lg:max-w-6xl lg:flex-row lg:items-center lg:px-8">
          <div className="flex items-center gap-3">
            <h1 className="whitespace-nowrap text-lg font-bold text-neutral-100">英会話学習</h1>
            <AiCost />
          </div>
          <Tabs />
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6 lg:max-w-6xl lg:px-8">{children}</main>
    </div>
  )
}
