'use client'

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Загружаю">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl border border-[#e4e4e0] bg-white" />
      ))}
    </div>
  )
}

export function LoadError({ what, reason, onRetry }: { what: string; reason: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
      Не удалось загрузить {what}: {reason}.
      {onRetry && (
        <button type="button" onClick={onRetry} className="ml-2 underline underline-offset-2 hover:no-underline">
          Повторить
        </button>
      )}
    </div>
  )
}
