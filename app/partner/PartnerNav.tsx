'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Левое меню кабинета партнёра (дизайн из прототипа, класс .pcab .side).
// Имя клиента и счётчики (просчёты/заказы) берём из /api/partner/orders.
// На узком экране сайдбар сжимается в колонку иконок (см. PartnerTheme).

const CALC_CHILDREN = [
  { href: '/partner/new', label: 'Новый просчёт', emo: '➕' },
  { href: '/partner/quotes', label: 'Мои просчёты', badge: 'quotes' as const, emo: '📄' },
  { href: '/partner/orders', label: 'Заказы в работе', badge: 'inwork' as const, emo: '🔧' },
  { href: '/partner/shipped', label: 'Отгруженные', badge: 'shipped' as const, emo: '📦' },
]

type OrderLite = { lane: 'quote' | 'submitted' | 'in_work' | 'shipped' }

function initials(name: string): string {
  const parts = name.replace(/[«»"']/g, '').trim().split(/\s+/).filter(Boolean)
  const letters = parts.slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
  return letters || 'МG'
}

export default function PartnerNav() {
  const path = usePathname()
  const inCalc = CALC_CHILDREN.some(c => path.startsWith(c.href))
  const [open, setOpen] = useState(true)
  const [client, setClient] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ quotes: number; inwork: number; shipped: number }>({ quotes: 0, inwork: 0, shipped: 0 })
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    fetch('/api/partner/orders').then(r => r.json()).then((d: { client?: { name: string } | null; orders?: OrderLite[] }) => {
      if (d.client?.name) setClient(d.client.name)
      const os = d.orders ?? []
      setCounts({
        quotes: os.filter(o => o.lane === 'quote').length,
        inwork: os.filter(o => o.lane === 'submitted' || o.lane === 'in_work').length,
        shipped: os.filter(o => o.lane === 'shipped').length,
      })
    }).catch(() => {})
    fetch('/api/partner/notifications').then(r => r.json()).then((d: { unread?: number }) => setUnread(d.unread ?? 0)).catch(() => {})
  }, [])

  const item = (active: boolean, extra = '') => `it${active ? ' on' : ''}${extra ? ' ' + extra : ''}`
  const badgeFor = (b?: 'quotes' | 'inwork' | 'shipped') => (b ? counts[b] : 0)

  return (
    <aside className="side">
      <div className="brand">
        <div className="logo" aria-label="M-Glass">
          <svg viewBox="0 0 64 56" xmlns="http://www.w3.org/2000/svg">
            <polygon points="0,3 15,3 15,53 0,53" fill="var(--brand-lt)" />
            <polygon points="15,3 32,28 32,44 15,19" fill="var(--brand-lt)" />
            <polygon points="49,3 64,3 64,53 49,53" fill="var(--brand-dk)" />
            <polygon points="49,3 32,28 32,44 49,19" fill="var(--brand-dk)" />
          </svg>
        </div>
        <div><div className="co">M‑GLASS</div><div className="sub">Кабинет заказчика</div></div>
      </div>

      <nav className="nav">
        <div className="lbl">Работа</div>
        <Link href="/partner" className={item(path === '/partner')}>
          <span className="ic"><svg viewBox="0 0 20 20"><rect x="3" y="3" width="6" height="6" rx="1.4" /><rect x="11" y="3" width="6" height="6" rx="1.4" /><rect x="3" y="11" width="6" height="6" rx="1.4" /><rect x="11" y="11" width="6" height="6" rx="1.4" /></svg></span>
          <span className="tx">Табло</span>
        </Link>

        <Link href="/partner/notifications" className={item(path.startsWith('/partner/notifications'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><path d="M6 8a4 4 0 0 1 8 0c0 4 1.5 5 1.5 5h-11S6 12 6 8Z" /><path d="M8.5 16a1.5 1.5 0 0 0 3 0" /></svg></span>
          <span className="tx">Уведомления</span>
          {unread > 0 && !path.startsWith('/partner/notifications') && <span className="badge">{unread}</span>}
        </Link>

        <div className={`grp${open || inCalc ? ' open' : ''}`}>
          <button className="it" onClick={() => setOpen(o => !o)}>
            <span className="ic"><svg viewBox="0 0 20 20"><rect x="4.5" y="2.5" width="11" height="15" rx="2" /><line x1="7.2" y1="6" x2="12.8" y2="6" /><line x1="7.2" y1="10.5" x2="12.8" y2="10.5" /><line x1="7.2" y1="14" x2="12.8" y2="14" /></svg></span>
            <span className="tx">Калькулятор</span><span className="chev">▾</span>
          </button>
          <div className="sub">
            {CALC_CHILDREN.map(c => {
              const n = badgeFor(c.badge)
              return (
                <Link key={c.href} href={c.href} className={item(path.startsWith(c.href))}>
                  <span className="emo" aria-hidden>{c.emo}</span>
                  <span className="tx">{c.label}</span>
                  {n > 0 && <span className="badge">{n}</span>}
                </Link>
              )
            })}
          </div>
        </div>

        <Link href="/partner/documents" className={item(path.startsWith('/partner/documents'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><path d="M6 2.5h5l3 3V17a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 6 17Z" /><path d="M11 2.5V6h3" /></svg></span>
          <span className="tx">Документы</span>
        </Link>

        <Link href="/partner/catalog" className={item(path.startsWith('/partner/catalog'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><path d="M5 6h10l-1 11H6z" /><path d="M7.5 6a2.5 2.5 0 0 1 5 0" /></svg></span>
          <span className="tx">Каталог</span>
        </Link>

        <div className="lbl">Помощь</div>
        <Link href="/partner/profile" className={item(path.startsWith('/partner/profile'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><circle cx="10" cy="7" r="3.2" /><path d="M4.5 16.5a5.5 5.5 0 0 1 11 0" /></svg></span>
          <span className="tx">Профиль</span>
        </Link>
        <Link href="/partner/claims" className={item(path.startsWith('/partner/claims'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><path d="M10 2.5 2.5 16.5h15z" /><line x1="10" y1="8" x2="10" y2="12" /><line x1="10" y1="14.2" x2="10" y2="14.25" /></svg></span>
          <span className="tx">Гарантия</span>
        </Link>
        <Link href="/partner/guide" className={item(path.startsWith('/partner/guide'))}>
          <span className="ic"><svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="7.4" /><path d="M7.9 7.6a2.2 2.2 0 1 1 3 2c-.8.5-1 1-1 1.9" /><line x1="10" y1="14.3" x2="10" y2="14.35" /></svg></span>
          <span className="tx">Как пользоваться</span>
        </Link>
      </nav>

      <div className="who">
        <div className="av">{initials(client ?? 'M Glass')}</div>
        <div className="min-w-0">
          <div className="nm">{client ?? 'Кабинет'}</div>
          <div className="rl">Партнёр M-Glass</div>
        </div>
        <button className="out" title="Выйти"
          onClick={async () => { await createClient().auth.signOut(); window.location.href = '/login' }}>⎋</button>
      </div>
    </aside>
  )
}
