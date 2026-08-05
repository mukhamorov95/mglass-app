'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Левое меню кабинета партнёра (тёмная премиальная тема). Раздел «Калькулятор» —
// раскрывающийся: Калькулятор → Просчёты → Заказы. На мобильном скрыто.

const CALC_CHILDREN = [
  { href: '/partner/new', label: 'Новый просчёт' },
  { href: '/partner/quotes', label: 'Мои просчёты' },
  { href: '/partner/orders', label: 'Мои заказы' },
]

function MMark() {
  return (
    <svg viewBox="0 0 64 56" className="w-8 h-7" xmlns="http://www.w3.org/2000/svg">
      <polygon points="0,3 15,3 15,53 0,53" fill="var(--p-brand-lt)" />
      <polygon points="15,3 32,28 32,44 15,19" fill="var(--p-brand-lt)" />
      <polygon points="49,3 64,3 64,53 49,53" fill="var(--p-brand-dk)" />
      <polygon points="49,3 32,28 32,44 49,19" fill="var(--p-brand-dk)" />
    </svg>
  )
}

export default function PartnerNav() {
  const path = usePathname()
  const inCalc = CALC_CHILDREN.some(c => path.startsWith(c.href))
  const [open, setOpen] = useState(true)

  const itemCls = (active: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium transition-colors ${active ? 'bg-[var(--p-acc)] text-[var(--p-acc-ink)]' : 'text-[var(--p-ink2)] hover:bg-[var(--p-surface2)] hover:text-[var(--p-ink)]'}`

  return (
    <aside className="hidden lg:flex flex-col w-60 flex-shrink-0 bg-[var(--p-surface)] border-r border-[var(--p-border)]">
      <div className="px-4 py-5 border-b border-[var(--p-border)]">
        <div className="flex items-center gap-2.5">
          <MMark />
          <div>
            <p className="text-[14px] font-extrabold tracking-wide text-[var(--p-ink)] leading-tight">M‑GLASS</p>
            <p className="text-[11px] text-[var(--p-muted)] leading-tight">Кабинет партнёра</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2.5 space-y-0.5">
        <Link href="/partner" className={itemCls(path === '/partner')}>
          <span>📊</span>Табло
        </Link>

        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-[10px] text-[13px] font-medium text-[var(--p-ink2)] hover:bg-[var(--p-surface2)] hover:text-[var(--p-ink)] transition-colors">
          <span>🧮</span>Калькулятор
          <span className={`ml-auto text-[10px] text-[var(--p-muted)] transition-transform ${open || inCalc ? '' : '-rotate-90'}`}>▾</span>
        </button>
        {(open || inCalc) && (
          <div className="ml-3.5 pl-3 border-l border-[var(--p-border)] space-y-0.5">
            {CALC_CHILDREN.map(c => (
              <Link key={c.href} href={c.href} className={itemCls(path.startsWith(c.href))}>
                {c.label}
              </Link>
            ))}
          </div>
        )}

        <Link href="/partner/catalog" className={itemCls(path.startsWith('/partner/catalog'))}>
          <span>🛍️</span>Каталог
        </Link>
      </nav>

      <div className="p-2.5 border-t border-[var(--p-border)]">
        <button onClick={async () => { await createClient().auth.signOut(); window.location.href = '/login' }}
          className="w-full text-left px-3 py-2 rounded-[10px] text-[12px] text-[var(--p-muted)] hover:bg-[var(--p-surface2)] hover:text-[var(--p-ink)] transition-colors">Выйти</button>
      </div>
    </aside>
  )
}
