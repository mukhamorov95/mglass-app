'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// Уведомления кабинета (дизайн .pcab): статусы заказов, приглашение, подтверждения.
// Данные — /api/partner/notifications (строго свои). Открытие ленты помечает прочитанным.

type Item = { id: number; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

const ICON: Record<string, string> = {
  access: '👋', submitted: '📨', in_work: '🏭', ready: '✅', shipped: '🚚', recalc: '✎',
  drawing_approved: '📐', drawing_rework: '✎',
}
const fmt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function PartnerNotificationsPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [linked, setLinked] = useState(true)

  useEffect(() => {
    fetch('/api/partner/notifications').then(r => r.json()).then((d: { linked: boolean; items: Item[] }) => {
      setLinked(d.linked); setItems(d.items ?? [])
      if (d.linked && (d.items ?? []).some(i => !i.read_at)) {
        fetch('/api/partner/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {})
      }
    }).catch(() => setLinked(false)).finally(() => setLoading(false))
  }, [])

  return (
    <>
      <div className="top">
        <div>
          <h1>Уведомления</h1>
          <div className="cap">Статусы заказов и события кабинета</div>
        </div>
        <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
      </div>

      <div className="wrap">
        {loading && <div className="note"><div className="s">Загрузка…</div></div>}
        {!loading && !linked && <div className="note"><div className="s">Аккаунт ещё не привязан к вашей компании.</div></div>}
        {!loading && linked && items.length === 0 && (
          <div className="note"><div className="t">Пока пусто</div><div className="s">Здесь появятся уведомления о статусе ваших заказов.</div></div>
        )}
        {!loading && linked && items.length > 0 && (
          <div className="card">
            {items.map((n, i) => {
              const inner = (
                <>
                  <div className="fi" style={{ fontSize: 16 }}>{ICON[n.kind] ?? '•'}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="fn" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {n.title}
                      {!n.read_at && <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
                    </div>
                    {n.body && <div className="fm" style={{ marginTop: 2 }}>{n.body}</div>}
                    <div className="fm" style={{ marginTop: 3, opacity: .8 }}>{fmt(n.created_at)}</div>
                  </div>
                </>
              )
              const cls = `doc${i === 0 ? ' first' : ''}`
              return n.link
                ? <Link key={n.id} href={n.link} className={cls} style={{ textDecoration: 'none', cursor: 'pointer' }}>{inner}</Link>
                : <div key={n.id} className={cls}>{inner}</div>
            })}
          </div>
        )}
      </div>
    </>
  )
}
