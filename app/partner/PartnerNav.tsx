'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'

// Левое меню кабинета партнёра. Никакой нашей внутренней навигации — только его
// разделы. На мобильном скрыто (навигация — кнопками в шапке страниц).

const LINKS = [
  { href: '/partner', label: 'Мои заказы', icon: '📦' },
  { href: '/partner/new', label: 'Новый просчёт', icon: '🧮' },
]

export default function PartnerNav() {
  const path = usePathname()
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
        {LINKS.map(l => {
          const active = l.href === '/partner' ? path === '/partner' : path.startsWith(l.href)
          return (
            <Link key={l.href} href={l.href}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] transition-colors ${active ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f5f5f3]'}`}>
              <span>{l.icon}</span>{l.label}
            </Link>
          )
        })}
      </nav>
      <div className="p-2 border-t border-[#f0f0ec]">
        <button onClick={async () => { await createClient().auth.signOut(); window.location.href = '/login' }}
          className="w-full text-left px-3 py-2 rounded-lg text-[12px] text-[#9a9a95] hover:bg-[#f5f5f3] transition-colors">Выйти</button>
      </div>
    </aside>
  )
}
