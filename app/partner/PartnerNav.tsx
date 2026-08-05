'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Левое меню кабинета партнёра. Раздел «Калькулятор» — раскрывающийся:
// Калькулятор → Просчёты → Заказы (последовательность для клиента).
// На мобильном скрыто (навигация — кнопками в шапке страниц).

const CALC_CHILDREN = [
  { href: '/partner/new', label: 'Новый просчёт' },
  { href: '/partner/quotes', label: 'Мои просчёты' },
  { href: '/partner/orders', label: 'Мои заказы' },
]

export default function PartnerNav() {
  const path = usePathname()
  const inCalc = CALC_CHILDREN.some(c => path.startsWith(c.href))
  const [open, setOpen] = useState(true)

  const itemCls = (active: boolean) =>
    `flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors ${active ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f5f5f3]'}`

  return (
    <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 bg-white border-r border-[#e4e4e0]">
      <div className="px-4 py-5 border-b border-[#f0f0ec]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#111110] text-white flex items-center justify-center text-[12px] font-bold">MG</div>
          <div>
            <p className="text-[14px] font-bold text-[#111110] leading-tight">M-Glass</p>
            <p className="text-[11px] text-[#9a9a95] leading-tight">Кабинет партнёра</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        <Link href="/partner" className={itemCls(path === '/partner')}>
          <span>📊</span>Табло
        </Link>

        {/* Раскрывающийся раздел «Калькулятор» */}
        <button onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors">
          <span>🧮</span>Калькулятор
          <span className={`ml-auto text-[10px] text-[#9a9a95] transition-transform ${open || inCalc ? '' : '-rotate-90'}`}>▾</span>
        </button>
        {(open || inCalc) && (
          <div className="ml-3 pl-3 border-l border-[#f0f0ec] space-y-0.5">
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

      <div className="p-2 border-t border-[#f0f0ec]">
        <button onClick={async () => { await createClient().auth.signOut(); window.location.href = '/login' }}
          className="w-full text-left px-3 py-2 rounded-lg text-[12px] text-[#9a9a95] hover:bg-[#f5f5f3] transition-colors">Выйти</button>
      </div>
    </aside>
  )
}
