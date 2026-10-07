'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { loadTodayOrders } from '@/lib/b2b/loadTodayOrders'
import { backfillCandidates, SHIP_RECENT_DAYS, daysText, type BackfillRow } from '@/lib/b2b/todayPriorities'
import { mskDayKey } from '@/lib/time'
import { toast, responseError, NETWORK_ERROR } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'

// Разбор отгрузок без отметки (решение владельца 30.09): менеджер закрывает хвост разом,
// у каждого заказа — своя дата. По умолчанию выбраны заказы старше 14 дней: почти
// всегда они уехали, но отметку никто не поставил. С 08.10 сюда же ведёт «Отметить месяц
// отгруженным» из /b2b-orders: там всем ставилась сегодняшняя дата.

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`
const ordersWord = (n: number) => {
  const d10 = n % 10, d100 = n % 100
  if (d10 === 1 && d100 !== 11) return 'заказ'
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return 'заказа'
  return 'заказов'
}
const CHUNK = 200

type Mode = 'old' | 'all'

export default function ShipmentsClient({ focusId }: { focusId: number | null }) {
  const [rows, setRows] = useState<BackfillRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(focusId ? 'all' : 'old')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dates, setDates] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [today, setToday] = useState('')
  const focusRef = useRef<HTMLTableRowElement>(null)

  const load = useCallback(async (keepSelection: boolean) => {
    const { orders, error: err } = await loadTodayOrders(createClient())
    if (err) { setError(err); return }
    const now = Date.now()
    const list = backfillCandidates(orders, now)
    setError(null)
    setToday(mskDayKey(now))
    setRows(list)
    setDates(prev => Object.fromEntries(list.map(r => [r.id, prev[r.id] ?? r.defaultDate])))
    if (!keepSelection) {
      setSelected(new Set(focusId ? list.filter(r => r.id === focusId).map(r => r.id) : list.filter(r => r.days > SHIP_RECENT_DAYS).map(r => r.id)))
    } else {
      setSelected(prev => new Set([...prev].filter(id => list.some(r => r.id === id))))
    }
  }, [focusId])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка при открытии; состояние меняется после ответа сервера
  useEffect(() => { void load(false) }, [load])
  useEffect(() => { if (rows && focusId) focusRef.current?.scrollIntoView({ block: 'center' }) }, [rows, focusId])

  const shown = useMemo(() => (rows ?? []).filter(r => mode === 'all' || r.days > SHIP_RECENT_DAYS), [rows, mode])
  const oldCount = useMemo(() => (rows ?? []).filter(r => r.days > SHIP_RECENT_DAYS).length, [rows])
  const picked = shown.filter(r => selected.has(r.id))
  const pickedSum = picked.reduce((s, r) => s + r.amount, 0)
  const allShownPicked = shown.length > 0 && picked.length === shown.length

  const toggle = (id: number) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleAll = () => setSelected(prev => {
    const next = new Set(prev)
    if (allShownPicked) shown.forEach(r => next.delete(r.id)); else shown.forEach(r => next.add(r.id))
    return next
  })

  async function submit() {
    const items = picked.map(r => ({ order_id: r.id, date: dates[r.id] ?? r.defaultDate }))
    if (items.length === 0) return
    const ok = await confirmDialog({
      title: `Отметить ${items.length} ${ordersWord(items.length)} отгруженными?`,
      text: 'Каждому — дата из его строки. Клиентам с кабинетом письма не уйдут: отгрузка прошлая. Отмечайте только то, что точно уехало.',
      confirmLabel: 'Отметить',
    })
    if (!ok) return
    setSaving(true)
    const done: number[] = []
    const skipped: { order_id: number; reason: string }[] = []
    try {
      for (let i = 0; i < items.length; i += CHUNK) {
        const part = items.slice(i, i + CHUNK)
        let r: Response
        try {
          r = await fetch('/api/b2b-orders/ship-backfill', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: part }),
          })
        } catch {
          toast.error('Отметки не записаны', { detail: `${NETWORK_ERROR}. Уже отмечено: ${done.length}. Нажмите ещё раз — отмеченные повторно не запишутся.` })
          return
        }
        if (!r.ok) {
          toast.error('Отметки не записаны', { detail: `${await responseError(r)}. Уже отмечено: ${done.length}.` })
          return
        }
        const j = await r.json() as { done: number[]; skipped: { order_id: number; reason: string }[] }
        done.push(...j.done); skipped.push(...j.skipped)
      }
    } finally {
      setSaving(false)
      await load(true)
    }
    if (done.length) toast.success(`Отмечено отгруженными: ${done.length}`, { detail: 'Они ушли из «Мой день · B2B» и из этого списка.' })
    if (skipped.length) {
      const refOf = (id: number) => rows?.find(r => r.id === id)?.ref ?? `#${id}`
      toast.error(`Не отмечено: ${skipped.length}`, {
        detail: skipped.slice(0, 5).map(s => `${refOf(s.order_id)} — ${s.reason}`).join('; ') + (skipped.length > 5 ? '; …' : ''),
      })
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto pb-28">
      <div className="mb-4">
        <Link href="/b2b-today" className="text-[12px] text-[#9a9a95] hover:text-[#6b6b66]">← Мой день · B2B</Link>
        <h1 className="text-[22px] font-bold text-[#111110] mt-1">Отгрузки без отметки</h1>
        <p className="text-[13px] text-[#6b6b66] mt-1 max-w-[70ch]">
          Заказ упакован или его срок прошёл, а отметки «Отгружен» нет. У каждого заказа предложена дата — день упаковки, а если его нет, срок.
          Поправьте, если помните точнее. Не уверены, что заказ уехал, — снимите галочку: он останется в списке.
        </p>
      </div>

      <div className="flex gap-1 mb-3">
        {([['old', `Старше ${SHIP_RECENT_DAYS} дней`, oldCount], ['all', 'Все без отметки', rows?.length ?? 0]] as const).map(([k, label, n]) => (
          <button key={k} onClick={() => setMode(k)}
            className={`px-3 py-1.5 text-[12px] font-medium rounded-md border ${mode === k ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:bg-[#f5f5f3]'}`}>
            {label} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-[#c23a2b] bg-white border border-[#eec5bf] rounded-xl px-4 py-3">{error}</p>
      ) : !rows ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : shown.length === 0 ? (
        <p className="text-[13px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-xl px-4 py-6 text-center">
          {mode === 'old' ? `Разбирать нечего: заказов старше ${SHIP_RECENT_DAYS} дней без отметки нет.` : 'Упакованных и просроченных заказов без отметки нет.'}
        </p>
      ) : (
        <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-[#9a9a95] border-b border-[#e4e4e0]">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={allShownPicked} onChange={toggleAll} aria-label="Выбрать все" />
                </th>
                <th className="text-left font-semibold px-2 py-2">Заказ</th>
                <th className="text-right font-semibold px-2 py-2">Сумма</th>
                <th className="text-left font-semibold px-2 py-2">Срок</th>
                <th className="text-left font-semibold px-2 py-2">Упакован</th>
                <th className="text-left font-semibold px-2 py-2">Отгружен</th>
                <th className="text-left font-semibold px-3 py-2">Кто вёл</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id} ref={r.id === focusId ? focusRef : undefined}
                  className={`border-b border-[#f5f5f3] last:border-0 ${r.id === focusId ? 'bg-[#fbf2e1]' : selected.has(r.id) ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Выбрать ${r.ref}`} />
                  </td>
                  <td className="px-2 py-2 min-w-0">
                    <Link href={`/b2b-deal/${r.id}`} className="font-medium text-[#111110] hover:underline">{r.ref}</Link>
                    <span className="text-[#6b6b66]"> · {r.client}</span>
                  </td>
                  <td className="px-2 py-2 text-right font-mono whitespace-nowrap">{fmt(r.amount)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {dm(r.deadlineDay)}{r.overdueDays != null && <span className="text-[11px] text-[#c23a2b]"> +{daysText(r.overdueDays)}</span>}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-[#6b6b66]">{r.packagedDay ? dm(r.packagedDay) : '—'}</td>
                  <td className="px-2 py-2">
                    <input type="date" value={dates[r.id] ?? r.defaultDate} max={today || undefined}
                      onChange={e => setDates(d => ({ ...d, [r.id]: e.target.value }))}
                      className="border border-[#e4e4e0] rounded-md px-2 py-1 text-[12px] bg-white outline-none focus:border-[#111110]" />
                  </td>
                  <td className="px-3 py-2 text-[#6b6b66] whitespace-nowrap">{r.owner ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {picked.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 lg:left-[250px] z-30 border-t border-[#e4e4e0] bg-white/95 backdrop-blur px-4 py-3" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-[#111110]">
              Выбрано <b className="tabular-nums">{picked.length}</b> {ordersWord(picked.length)} на <span className="font-mono">{fmt(pickedSum)}</span>
            </p>
            <button onClick={() => void submit()} disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-50">
              {saving ? 'Отмечаю…' : 'Отметить отгруженными'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
