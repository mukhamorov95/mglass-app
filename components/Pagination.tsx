'use client'

interface PaginationProps {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  className?: string
}

export default function Pagination({ page, total, pageSize, onPageChange, className = '' }: PaginationProps) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  if (total === 0) return null

  return (
    <div className={`flex items-center justify-between text-[12px] text-[#8a8a85] ${className}`}>
      <span>Показано {from}–{to} из {total.toLocaleString('ru-RU')}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="px-2.5 py-1 rounded-lg border border-[#e4e4e0] bg-white hover:bg-[#f8f8f7] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          ←
        </button>
        <span className="px-3 py-1 font-medium text-[#111110]">{page} / {maxPage}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= maxPage}
          className="px-2.5 py-1 rounded-lg border border-[#e4e4e0] bg-white hover:bg-[#f8f8f7] disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
          →
        </button>
      </div>
    </div>
  )
}
