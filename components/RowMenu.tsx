'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

// Меню строки «⋯» (У5). В строке просчёта было 11 значков подряд: «Удалить» стояло
// рядом с «PDF», и значение каждого приходилось вспоминать по картинке. Здесь
// действия названы словами и разбиты на группы; опасное — отдельно и красным.
//
// Рисуется в портале с position: fixed. Абсолютный список внутри строки обрезался
// карточкой списка (у неё overflow-hidden ради скруглённых углов): в DOM меню было,
// размер правильный, а на экране его не видно — поймано проверкой в проде.

export type MenuItem =
  | { kind?: 'item'; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }
  | { kind: 'link'; label: string; href: string; newTab?: boolean; external?: boolean }
  | { kind: 'divider' }

const MENU_WIDTH = 220

export default function RowMenu({ items, label = 'Ещё действия' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const menu = useRef<HTMLDivElement>(null)

  // Место под кнопкой; если снизу не помещается — над кнопкой, и никогда за краем окна.
  useLayoutEffect(() => {
    if (!open || !box.current) { setPos(null); return }
    const place = () => {
      const r = box.current?.getBoundingClientRect()
      if (!r) return
      const h = menu.current?.offsetHeight ?? 0
      const below = window.innerHeight - r.bottom
      const top = h > 0 && below < h + 8 && r.top > h + 8 ? r.top - h - 4 : r.bottom + 4
      setPos({ top, left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)) })
    }
    place()
    const t = setTimeout(place, 0)  // второй проход — когда высота меню уже известна
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { clearTimeout(t); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (box.current?.contains(t) || menu.current?.contains(t)) return
      setOpen(false)
    }
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
      {open && typeof document !== 'undefined' && createPortal(
        <div role="menu" ref={menu}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: MENU_WIDTH, visibility: pos ? 'visible' : 'hidden' }}
          className="z-50 bg-white border border-[#e4e4e0] rounded-xl shadow-[0_4px_16px_rgba(0,0,0,0.10)] py-1">
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
        </div>,
        document.body,
      )}
    </div>
  )
}
