// Скелетоны вместо слова «Загрузка…» (У6). Форма повторяет то, что появится:
// таблица — строками, карточка — блоками. Так экран не прыгает, когда данные
// пришли, и человек понимает, что именно грузится.

export function SkeletonBar({ className = '' }: { className?: string }) {
  return <div className={`bg-[#ebebe8] rounded animate-pulse ${className}`} />
}

export function SkeletonTable({ rows = 8, title = true }: { rows?: number; title?: boolean }) {
  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6" aria-busy="true" aria-label="Данные загружаются">
      <div className="max-w-[1400px] mx-auto">
        {title && <SkeletonBar className="h-5 w-48 mb-5" />}
        <div className="bg-white border border-[#e4e4e0] rounded-2xl divide-y divide-[#f0f0ec]">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <SkeletonBar className="h-3.5 flex-1" />
              <SkeletonBar className="h-3.5 w-24 hidden sm:block" />
              <SkeletonBar className="h-3.5 w-20" />
              <SkeletonBar className="h-6 w-28 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkeletonCard({ blocks = 4 }: { blocks?: number }) {
  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6" aria-busy="true" aria-label="Карточка загружается">
      <div className="max-w-4xl mx-auto space-y-3">
        <SkeletonBar className="h-6 w-56" />
        {Array.from({ length: blocks }, (_, i) => (
          <div key={i} className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4 space-y-2">
            <SkeletonBar className="h-2.5 w-24" />
            <SkeletonBar className="h-3.5 w-full" />
            <SkeletonBar className="h-3.5 w-4/5" />
          </div>
        ))}
      </div>
    </div>
  )
}
