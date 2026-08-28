'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// A17: Гарантия и сервис — заявки на рекламацию. Список своих + создание.
// ?order=<id> из карточки заказа предзаполняет заявку по конкретному заказу.

type Claim = {
  id: number; order_id: number | null; orderNumber: string | null; kind: string; kindLabel: string
  description: string; status: string; resolution: string | null; created_at: string; resolved_at: string | null
}

const KINDS: { v: string; l: string }[] = [
  { v: 'boy', l: 'Бой / трещина' }, { v: 'skol', l: 'Скол / царапина' },
  { v: 'mismatch', l: 'Не подошло по размеру' }, { v: 'hardware', l: 'Проблема с фурнитурой' }, { v: 'other', l: 'Другое' },
]
const STATUS: Record<string, { l: string; cls: string }> = {
  open: { l: 'Принято', cls: 'p-sub' }, in_review: { l: 'На рассмотрении', cls: 'p-work' },
  resolved: { l: 'Решено', cls: 'p-ready' }, rejected: { l: 'Отклонено', cls: 'p-ship' },
}
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })

export default function PartnerClaimsPage() {
  const initialOrder = typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('order') || '') : ''
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [linked, setLinked] = useState(true)
  const [open, setOpen] = useState(!!initialOrder)
  const [orderId, setOrderId] = useState<string>(initialOrder)
  const [kind, setKind] = useState('boy')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function load() {
    return fetch('/api/partner/claims').then(r => r.json())
      .then((d: { linked: boolean; claims: Claim[] }) => { setLinked(d.linked); setClaims(d.claims ?? []) })
      .catch(() => setLinked(false))
  }
  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [])

  async function submit() {
    if (!desc.trim()) { setErr('Опишите проблему'); return }
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/partner/claims', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, description: desc, orderId: orderId || undefined }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Ошибка'); return }
      setOpen(false); setDesc(''); setOrderId(''); await load()
    } catch { setErr('Сеть недоступна') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>Гарантия и сервис</h1>
          <div className="cap">Рекламации и обращения по заказам</div>
        </div>
        {!open && <button className="primary" onClick={() => { setOpen(true); setErr(null) }}>＋ Новая заявка</button>}
      </div>

      <div className="wrap">
        {open && (
          <div className="card" style={{ padding: 18, marginBottom: 14 }}>
            <div className="frm">
              <div className="fld">
                <span className="lab">Тип проблемы</span>
                <select value={kind} onChange={e => setKind(e.target.value)}>
                  {KINDS.map(k => <option key={k.v} value={k.v}>{k.l}</option>)}
                </select>
              </div>
              <div className="fld">
                <span className="lab">Номер заказа (необязательно)</span>
                <input value={orderId} onChange={e => setOrderId(e.target.value.replace(/\D/g, ''))} placeholder="напр. 1024" />
              </div>
              <div className="fld full">
                <span className="lab">Описание</span>
                <textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Что случилось? Опишите дефект как можно подробнее." />
              </div>
              {err && <div className="fld full" style={{ color: '#dc2626', fontSize: 12 }}>{err}</div>}
              <div className="fld full" style={{ flexDirection: 'row', gap: 8 }}>
                <button className="primary" onClick={submit} disabled={busy}>{busy ? 'Отправляю…' : 'Отправить заявку'}</button>
                <button className="ghost" onClick={() => { setOpen(false); setErr(null) }}>Отмена</button>
              </div>
              <div className="info full"><span>ℹ️</span><span>Фото дефекта пока прикладывайте в переписке с менеджером — загрузку фото добавим позже.</span></div>
            </div>
          </div>
        )}

        {loading && <div className="note"><div className="s">Загрузка…</div></div>}
        {!loading && !linked && <div className="note"><div className="s">Аккаунт ещё не привязан к вашей компании.</div></div>}
        {!loading && linked && claims.length === 0 && !open && (
          <div className="note"><div className="t">Обращений нет</div><div className="s">Если с заказом что-то не так — создайте заявку, менеджер разберётся.</div></div>
        )}
        {!loading && claims.map(c => {
          const st = STATUS[c.status] ?? { l: c.status, cls: 'p-quote' }
          return (
            <div className="ord" key={c.id}>
              <div className="r1">
                <div>
                  <div className="num">{c.kindLabel}{c.orderNumber && <span className="yr"> · заказ {c.orderNumber}</span>}</div>
                  <div className="meta">от {fmtDate(c.created_at)}</div>
                  <div className="meta" style={{ marginTop: 3, color: 'var(--ink-2)' }}>{c.description}</div>
                  {c.resolution && <div className="meta" style={{ marginTop: 4, color: 'var(--green)' }}>Ответ: {c.resolution}</div>}
                </div>
                <span className={`pill ${st.cls}`} style={{ height: 'fit-content' }}>{st.l}</span>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
