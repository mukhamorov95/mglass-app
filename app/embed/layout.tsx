import type { ReactNode } from 'react'

// Голый layout для встраивания в сторонний сайт (Tilda) через iframe:
// без сайдбара/навигации приложения — только сам виджет.
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-[#f5f5f3]">{children}</div>
}
