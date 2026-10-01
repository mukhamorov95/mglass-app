'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

// Меню строки «⋯» (У5). В строке просчёта было 11 значков подряд: «Удалить» стояло
// рядом с «PDF», и значение каждого приходилось вспоминать по картинке. Здесь
// действия названы словами и разбиты на группы; опасное — отдельно и красным.

export type MenuItem =
  | { kind?: 'item'; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'link'; label: string; href: string; newTab?: boolean; external?: boolean }
  | { kind: 'divider' }

export default function RowMenu({ items, label = 'Ещё действия' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const itemCls = 'w-full text-left px-3 py-1.5 text-[12px] text-[#111110] hover:bg-[#f5f5f3] transition-colors block'

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        className="text-[13px] leading-none font-semibold px-2 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f4] hover:text-[#111110] transition-colors">
        ⋯
      </button>
      {open && (
        <div role="menu"
          className="absolute right-0 top-full mt-1 z-30 min-w-[210px] bg-white border border-[#e4e4e0] rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.10)] py-1">
          {items.map((it, i) => {
            if ('kind' in it && it.kind === 'divider') return <div key={i} className="h-px bg-[#f0f0ec] my-1" />
            if ('kind' in it && it.kind === 'link') {
              const common = { className: itemCls, role: 'menuitem' as const, onClick: () => setOpen(false) }
              return it.external || it.newTab
                ? <a key={i} href={it.href} target={it.newTab ? '_blank' : undefined} rel="noreferrer" {...common}>{it.label}</a>
                : <Link key={i} href={it.href} {...common}>{it.label}</Link>
            }
            const item = it as { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
            return (
              <button key={i} type="button" role="menuitem" disabled={item.disabled}
                onClick={() => { setOpen(false); item.onClick() }}
                className={`${itemCls} disabled:opacity-40 ${item.danger ? 'text-[#c23a2b] hover:bg-[#fdf0ef]' : ''}`}>
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
