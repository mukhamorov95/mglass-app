'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import TelegramLinkButton from '@/components/shopBoard/TelegramLinkButton'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { COLUMNS, doneWarning, dueFromInput, dueLabel, dueToInputs, isOverdue, mskDateTime, type CardAction, type CardEdit } from '@/lib/shopBoard/model'
import type { BoardCardView, BoardView, OrderRef } from '@/lib/shopBoard/server'
import type { OrderOption } from '@/lib/shopBoard/server'

type Loaded = Exclude<BoardView, { missing: true }>

const ddmm = (iso: string | null) => (iso ? mskDateTime(iso).slice(0, 5) : null)

// Короткий сигнал на новую карточку в режиме экрана. Браузер разрешает звук только после
// нажатия, поэтому в режиме экрана есть кнопка «Включить звук».
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.frequency.value = 880
    g.gain.setValueAtTime(0.25, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.6)
  } catch { /* звук — не главное */ }
}

export default function ShopBoard({ tv }: { tv: boolean }) {
  const [data, setData] = useState<BoardView | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [sound, setSound] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const known = useRef<Set<number> | null>(null)
  const soundRef = useRef(false)
  useEffect(() => { soundRef.current = sound }, [sound])

  useEffect(() => {
    let alive = true
    loadJson<BoardView>('/api/shop-board').then(res => {
      if (!alive) return
      if (res.error !== null) { setErr(res.error); return }
      setErr(null)
      setData(res.data)
      setUpdatedAt(Date.now())
      if (!res.data.missing) {
        const ids = new Set(res.data.cards.map(c => c.id))
        const prev = known.current
        if (prev && soundRef.current && [...ids].some(id => !prev.has(id))) beep()
        known.current = ids
      }
    })
    return () => { alive = false }
  }, [tick])

  // Табло живое: экран в цеху — раз в 30 с, остальные — раз в минуту.
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), tv ? 30_000 : 60_000)
    return () => clearInterval(t)
  }, [tv])
  const reload = () => setTick(n => n + 1)

  async function act(card: BoardCardView, action: CardAction) {
    if (action === 'close') {
      const ok = await confirmDialog({ title: 'Закрыть поручение?', text: `«${card.title}» уйдёт с табло в закрытые за неделю. Вернуть можно оттуда.`, confirmLabel: 'Закрыть' })
      if (!ok) return
    }
    if (action === 'done') {
      const warn = doneWarning(card.orders)
      if (warn) {
        const ok = await confirmDialog({
          title: 'Поручение точно выполнено?',
          text: `${warn} «Готово» убирает поручение из работы у всех. Если сделана только ваша часть — напишите об этом в 💬, а «Готово» нажмёт тот, кто закончит.`,
          confirmLabel: 'Да, всё готово',
        })
        if (!ok) return
      }
    }
    setBusy(card.id)
    const r = await sendOrToast('Не получилось', `/api/shop-board/${card.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    })
    setBusy(null)
    if (r) reload()
  }

  async function comment(card: BoardCardView, text: string): Promise<boolean> {
    const r = await sendOrToast('Комментарий не сохранён', `/api/shop-board/${card.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comment: text }),
    })
    if (r) reload()
    return !!r
  }

  async function edit(card: BoardCardView, change: CardEdit): Promise<boolean> {
    const r = await sendOrToast('Не сохранилось', `/api/shop-board/${card.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edit: change }),
    })
    if (r) reload()
    return !!r
  }

  // «Сейчас» — момент последней загрузки: табло само обновляется раз в 30–60 с.
  const now = updatedAt ?? 0
  const loaded = data && !data.missing ? (data as Loaded) : null

  return (
    <div className={`min-h-screen ${tv ? 'bg-[#111110] text-white' : 'bg-[#f5f5f3]'} pb-20`}>
      {!tv && (
        <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">🔥 Табло цеха</h1>
              <p className="text-[13px] text-[#9a9a95] mt-0.5">Поручения по заказам — видят весь цех и менеджеры</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <TelegramLinkButton />
              <Link href="/production-app/control?tv=1" className="hidden sm:inline-block text-[12px] px-3 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">📺 Экран цеха</Link>
              {loaded?.me.canCreate && (
                <button onClick={() => setFormOpen(o => !o)} className="text-[13px] font-semibold px-3.5 py-2 rounded-lg bg-[#111110] text-white">＋ Поручение</button>
              )}
            </div>
          </div>
          <ProductionTabs />
        </div>
      )}

      {tv && (
        <div className="px-6 pt-5 pb-3 flex items-baseline justify-between">
          <h1 className="text-[34px] font-bold tracking-tight">🔥 Табло цеха</h1>
          <div className="flex items-center gap-4 text-[18px] text-[#9a9a95]">
            {updatedAt && <span>обновлено {mskDateTime(new Date(updatedAt).toISOString()).slice(6)}</span>}
            <button onClick={() => { setSound(s => !s); if (!sound) beep() }} className="px-3 py-1.5 rounded-lg border border-[#3b3b38] text-white text-[16px]">
              {sound ? '🔊 звук включён' : '🔇 включить звук'}
            </button>
            <Link href="/production-app/control" className="text-[16px] underline">выйти</Link>
          </div>
        </div>
      )}

      <div className={`${tv ? 'px-6' : 'px-4 pt-4 max-w-6xl'} space-y-4`}>
        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[14px] text-red-800 flex items-center justify-between gap-3">
            <span>Табло не загрузилось: {err}</span>
            <button onClick={reload} className="underline flex-shrink-0">Повторить</button>
          </div>
        )}

        {data?.missing && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[14px] text-amber-900">
            Табло ждёт SQL владельца: <code>supabase/migrations/20261008_shop_board.sql</code> в SQL Editor Supabase.
          </div>
        )}

        {!data && !err && <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>}

        {formOpen && loaded?.me.canCreate && !tv && (
          <NewCardForm onDone={() => { setFormOpen(false); reload() }} onCancel={() => setFormOpen(false)} />
        )}

        {loaded && (
          <div className={`grid gap-3 ${tv ? 'grid-cols-3' : 'md:grid-cols-3'}`}>
            {COLUMNS.map(col => {
              const cards = loaded.cards.filter(c => c.status === col.status)
              return (
                <section key={col.status} className="min-w-0">
                  <h2 className={`${tv ? 'text-[22px] text-[#d6d6d2]' : 'text-[13px] text-[#6b6b66]'} font-semibold mb-2`}>
                    {col.label} <span className={tv ? 'text-white' : 'text-[#111110]'}>{cards.length}</span>
                  </h2>
                  <div className="space-y-2">
                    {cards.length === 0 && (
                      <p className={`${tv ? 'text-[18px] text-[#6b6b66]' : 'text-[12px] text-[#b0b0aa]'} px-1`}>пусто</p>
                    )}
                    {cards.map(c => (
                      <CardView key={c.id} card={c} tv={tv} now={now} me={loaded.me} busy={busy === c.id}
                        onAct={a => act(c, a)} onComment={t => comment(c, t)} onEdit={ch => edit(c, ch)} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {loaded && !tv && loaded.closed.length > 0 && (
          <details className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <summary className="text-[13px] text-[#6b6b66] cursor-pointer">Закрытые за неделю · {loaded.closed.length}</summary>
            <div className="mt-2 divide-y divide-[#f0f0ec]">
              {loaded.closed.map(c => (
                <div key={c.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#111110] truncate">{c.title}</p>
                    <p className="text-[11px] text-[#9a9a95]">
                      {c.orders.map(o => o.ref).join(', ')}{c.orders.length ? ' · ' : ''}закрыл {c.closed_by_name ?? '—'}{c.closed_at ? ` ${mskDateTime(c.closed_at)}` : ''}
                    </p>
                  </div>
                  {loaded.me.canCreate && (
                    <button disabled={busy === c.id} onClick={() => act(c, 'reopen')} className="text-[12px] underline text-[#6b6b66] flex-shrink-0">Вернуть</button>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

function OrderLine({ o, tv, now }: { o: OrderRef; tv: boolean; now: number }) {
  const late = o.deadline && !o.shipped && Date.parse(o.deadline) < now
  return (
    <div className={tv ? 'text-[17px]' : 'text-[12px]'}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        {tv
          ? <span className="font-semibold">{o.ref}</span>
          : <Link href={`/production-app/orders/${o.id}`} className="font-semibold text-[#111110] underline decoration-[#d6d6d2]">{o.ref}</Link>}
        <span className={tv ? 'text-[#d6d6d2]' : 'text-[#6b6b66]'}>{o.client ?? '—'}</span>
        {o.deadline && (
          <span className={late ? 'text-red-500 font-semibold' : tv ? 'text-[#9a9a95]' : 'text-[#9a9a95]'}>
            срок заказа {ddmm(o.deadline)}
          </span>
        )}
        {o.shipped ? <span className="text-emerald-500">🚚 отгружен</span> : o.packaged ? <span className="text-emerald-500">📦 упакован</span> : null}
      </div>
      {o.progress && o.progress.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {o.progress.map(p => {
            const full = p.done === p.total
            return (
              <span key={p.key} className={`px-1.5 py-0.5 rounded ${tv ? 'text-[15px]' : 'text-[10px]'} ${full ? 'bg-emerald-100 text-emerald-800' : p.done > 0 ? 'bg-amber-100 text-amber-800' : tv ? 'bg-[#2a2a28] text-[#9a9a95]' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>
                {p.label} {p.done}/{p.total}
              </span>
            )
          })}
        </div>
      )}
      {o.progress && o.progress.length === 0 && (
        <p className={tv ? 'text-[#6b6b66]' : 'text-[#9a9a95]'}>задач цеха по заказу нет</p>
      )}
    </div>
  )
}

function CardView({ card, tv, now, me, busy, onAct, onComment, onEdit }: {
  card: BoardCardView; tv: boolean; now: number; me: Loaded['me']; busy: boolean
  onAct: (a: CardAction) => void; onComment: (t: string) => Promise<boolean>; onEdit: (ch: CardEdit) => Promise<boolean>
}) {
  const [commenting, setCommenting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const late = isOverdue(card, now)
  const due = dueLabel(card, now)
  const canClose = me.isOwner || card.created_by === me.id
  const canEdit = canClose // то же правило, что canEditCard на сервере: поставивший или владелец
  // Комментарии и правки — одна лента: «кто что сказал и что поменял».
  const comments = card.events.filter(e => e.kind === 'comment' || e.kind === 'edited').slice(-3)
  const alarm = card.hot || late

  return (
    <div className={`rounded-xl border p-3 ${tv ? 'bg-[#1c1c1a]' : 'bg-white'} ${alarm ? 'border-red-500 border-2' : tv ? 'border-[#3b3b38]' : 'border-[#e4e4e0]'}`}>
      <div className="flex items-start justify-between gap-2">
        <p className={`${tv ? 'text-[24px] leading-tight' : 'text-[14px]'} font-semibold ${tv ? 'text-white' : 'text-[#111110]'}`}>
          {card.hot && '🔥 '}{card.title}
        </p>
        {card.mine && !tv && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 flex-shrink-0">мой заказ</span>}
      </div>
      {due && <p className={`${tv ? 'text-[19px]' : 'text-[12px]'} mt-0.5 font-semibold ${late ? 'text-red-500' : tv ? 'text-amber-300' : 'text-amber-700'}`}>{due}</p>}

      {card.orders.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {card.orders.map(o => <OrderLine key={o.id} o={o} tv={tv} now={now} />)}
        </div>
      )}

      {card.details && <p className={`mt-2 whitespace-pre-wrap ${tv ? 'text-[17px] text-[#d6d6d2]' : 'text-[12px] text-[#3b3b38]'}`}>{card.details}</p>}

      <p className={`mt-2 ${tv ? 'text-[15px] text-[#9a9a95]' : 'text-[11px] text-[#9a9a95]'}`}>
        поставил {card.created_by_name ?? '—'} {mskDateTime(card.created_at)}
        {card.taken_by_name && ` · взял ${card.taken_by_name}`}
        {card.done_by_name && ` · готово: ${card.done_by_name}`}
      </p>

      {comments.length > 0 && (
        <div className={`mt-2 space-y-1 ${tv ? 'text-[16px]' : 'text-[12px]'}`}>
          {comments.map(e => (
            <p key={e.id} className={tv ? 'text-[#d6d6d2]' : 'text-[#3b3b38]'}>
              {e.kind === 'edited' ? '✏️' : '💬'} <span className="font-medium">{e.by_name ?? '—'}:</span> {e.text}
            </p>
          ))}
        </div>
      )}

      {!tv && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {me.canCreate && card.status === 'new' && (
            <button disabled={busy} onClick={() => onAct('take')} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white disabled:opacity-50">Взял</button>
          )}
          {me.canCreate && (card.status === 'new' || card.status === 'in_progress') && (
            <button disabled={busy} onClick={() => onAct('done')} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white disabled:opacity-50">Готово</button>
          )}
          {me.canCreate && card.status === 'done' && (
            <button disabled={busy} onClick={() => onAct('reopen')} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">Вернуть</button>
          )}
          {canClose && (
            <button disabled={busy} onClick={() => onAct('close')} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">Закрыть</button>
          )}
          {canEdit && (
            <button onClick={() => { setEditing(v => !v); setCommenting(false) }} title="Горит и срок"
              className="text-[12px] px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">✏️</button>
          )}
          <button onClick={() => { setCommenting(v => !v); setEditing(false) }} className="text-[12px] px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">💬</button>
        </div>
      )}

      {editing && !tv && (
        <EditCard card={card} onCancel={() => setEditing(false)}
          onSave={async ch => { if (await onEdit(ch)) { setEditing(false); toast.success('Поручение изменено', { detail: 'Видно на табло и в ленте сразу; поставившему, взявшему и менеджеру заказа ушло уведомление' }) } }} />
      )}

      {commenting && !tv && (
        <form className="mt-2 flex gap-1.5" onSubmit={async e => {
          e.preventDefault()
          if (!text.trim()) return
          if (await onComment(text)) { setText(''); setCommenting(false); toast.success('Комментарий на табло') }
        }}>
          <input value={text} onChange={e => setText(e.target.value)} maxLength={1000} autoFocus
            placeholder="например: закалка завтра в 10" className="flex-1 min-w-0 text-[13px] px-2.5 py-1.5 rounded-lg border border-[#e4e4e0]" />
          <button className="text-[13px] px-3 py-1.5 rounded-lg bg-[#111110] text-white">Отправить</button>
        </form>
      )}
    </div>
  )
}

// Правка «Горит» и срока. Шлём только то, что поменяли, — сервер пишет это в журнал словами.
function EditCard({ card, onSave, onCancel }: { card: BoardCardView; onSave: (ch: CardEdit) => Promise<void>; onCancel: () => void }) {
  const init = dueToInputs(card.due_at)
  const [hot, setHot] = useState(card.hot)
  const [date, setDate] = useState(init.date)
  const [time, setTime] = useState(init.time)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const ch: CardEdit = {}
    if (hot !== card.hot) ch.hot = hot
    if (date !== init.date || time !== init.time) {
      if (!date) ch.due_at = null
      else {
        const due = dueFromInput(date, time)
        if (!due) { setErr('Срок не распознан'); return }
        ch.due_at = due
      }
    }
    if (!Object.keys(ch).length) { setErr('Ничего не изменилось'); return }
    setErr(null)
    setSaving(true)
    await onSave(ch)
    setSaving(false)
  }

  return (
    <form onSubmit={save} className="mt-2 rounded-lg border border-[#e4e4e0] bg-[#fafaf9] p-2.5 space-y-2">
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={hot} onChange={e => setHot(e.target.checked)} className="w-4 h-4" />
        🔥 Горит
      </label>
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-[13px] px-2 py-1.5 rounded-lg border border-[#e4e4e0] bg-white" />
          <input type="time" value={time} onChange={e => setTime(e.target.value)} className="text-[13px] px-2 py-1.5 rounded-lg border border-[#e4e4e0] bg-white" />
          {date && <button type="button" onClick={() => { setDate(''); setTime('') }} className="text-[12px] underline text-[#6b6b66]">без срока</button>}
        </div>
        <p className="text-[11px] text-[#9a9a95] mt-0.5">по Москве; без времени — до 18:00</p>
      </div>
      {err && <p className="text-[12px] text-red-700">{err}</p>}
      <div className="flex gap-1.5">
        <button disabled={saving} className="text-[13px] font-semibold px-3 py-1.5 rounded-lg bg-[#111110] text-white disabled:opacity-50">{saving ? 'Сохраняю…' : 'Сохранить'}</button>
        <button type="button" onClick={onCancel} className="text-[13px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">Отмена</button>
      </div>
    </form>
  )
}

function NewCardForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [hot, setHot] = useState(false)
  const [orders, setOrders] = useState<OrderOption[]>([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState<OrderOption[]>([])
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const query = q.trim()
    if (!query) return
    let alive = true
    const t = setTimeout(() => {
      loadJson<{ orders: OrderOption[] }>(`/api/shop-board/orders?q=${encodeURIComponent(query)}`).then(res => {
        if (!alive) return
        if (res.error !== null) { setSearchErr(res.error); return }
        setSearchErr(null)
        setFound(res.data.orders)
      })
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setErr('Напишите, что сделать'); return }
    if (date && !dueFromInput(date, time)) { setErr('Срок не распознан'); return }
    setSaving(true)
    setErr(null)
    const res = await loadJson<{ ok: true }>('/api/shop-board', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, details, order_ids: orders.map(o => o.id), due_at: date ? dueFromInput(date, time) : null, hot }),
    })
    setSaving(false)
    if (res.error !== null) { setErr(res.error); return }
    toast.success('Поручение на табло', { detail: 'Видно цеху сверху «Цех сегодня» и «Мои задачи», менеджерам — в «Мой день»' })
    onDone()
  }

  const shown = q.trim() ? found.filter(f => !orders.some(o => o.id === f.id)) : []

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-[#e4e4e0] p-4 space-y-3 max-w-2xl">
      <div>
        <label className="text-[12px] text-[#6b6b66]">Что сделать</label>
        <input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoFocus
          placeholder="например: отгрузить клиенту завтра до 12:00" className="w-full mt-1 text-[14px] px-3 py-2 rounded-lg border border-[#e4e4e0]" />
      </div>

      <div>
        <label className="text-[12px] text-[#6b6b66]">Заказы</label>
        {orders.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {orders.map(o => (
              <span key={o.id} className="text-[12px] px-2 py-1 rounded-lg bg-[#f0f0ec] text-[#111110]">
                {o.ref} · {o.client ?? '—'}
                <button type="button" onClick={() => setOrders(list => list.filter(x => x.id !== o.id))} className="ml-1.5 text-[#9a9a95]">×</button>
              </span>
            ))}
          </div>
        )}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="номер или клиент: 05522, гласдекор"
          className="w-full mt-1 text-[14px] px-3 py-2 rounded-lg border border-[#e4e4e0]" />
        {searchErr && <p className="text-[12px] text-red-700 mt-1">Поиск не сработал: {searchErr}</p>}
        {shown.length > 0 && (
          <div className="mt-1 border border-[#e4e4e0] rounded-lg divide-y divide-[#f0f0ec] max-h-56 overflow-auto">
            {shown.map(o => (
              <button type="button" key={o.id} onClick={() => { setOrders(list => [...list, o]); setQ('') }}
                className="w-full text-left px-3 py-2 text-[13px] hover:bg-[#f5f5f3]">
                <span className="font-semibold">{o.ref}</span> · {o.client ?? '—'}
                {o.deadline && <span className="text-[#9a9a95]"> · срок заказа {ddmm(o.deadline)}</span>}
              </button>
            ))}
          </div>
        )}
        {q.trim() && !searchErr && shown.length === 0 && found.length === 0 && (
          <p className="text-[12px] text-[#9a9a95] mt-1">Среди заказов в работе не нашлось — отгруженные и архивные не ищутся</p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[12px] text-[#6b6b66]">Срок</label>
          <div className="flex gap-1.5 mt-1">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className="text-[14px] px-2.5 py-2 rounded-lg border border-[#e4e4e0]" />
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className="text-[14px] px-2.5 py-2 rounded-lg border border-[#e4e4e0]" />
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-0.5">по Москве; без времени — до 18:00</p>
        </div>
        <label className="flex items-center gap-2 text-[14px] pb-6">
          <input type="checkbox" checked={hot} onChange={e => setHot(e.target.checked)} className="w-4 h-4" />
          🔥 Горит
        </label>
      </div>

      <div>
        <label className="text-[12px] text-[#6b6b66]">Подробности</label>
        <textarea value={details} onChange={e => setDetails(e.target.value)} maxLength={2000} rows={2}
          placeholder="что известно, кто нужен, что мешает" className="w-full mt-1 text-[14px] px-3 py-2 rounded-lg border border-[#e4e4e0]" />
      </div>

      {err && <p className="text-[13px] text-red-700">{err}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="text-[14px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white disabled:opacity-50">
          {saving ? 'Ставлю…' : 'Поставить на табло'}
        </button>
        <button type="button" onClick={async () => {
          if ((title.trim() || details.trim() || orders.length) && !(await confirmDialog({ title: 'Выбросить поручение?', text: 'Написанное не сохранится.', confirmLabel: 'Выбросить', danger: true }))) return
          onCancel()
        }} className="text-[14px] px-4 py-2 rounded-lg border border-[#e4e4e0] text-[#6b6b66]">Отмена</button>
      </div>
    </form>
  )
}
