'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { loadJson } from '@/lib/toast'
import type { BoardOrder } from '@/lib/production/ordersBoard'
import { KANBAN_COLUMNS, SHIPPED_SHOW_DAYS, daysLeft, kanbanMatch, kanbanSort, materialLine, onKanban, type KanbanColumn } from '@/lib/production/stageKanban'

type Resp = { today: string; to: string; orders: BoardOrder[] }

const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—')

function daysTone(d: number | null) {
  if (d === null) return 'text-[#9a9a95]'
  if (d < 0) return 'text-[#c0392b]'
  if (d <= 1) return 'text-[#b9770e]'
  return 'text-[#111110]'
}

function Card({ o, today, tv }: { o: BoardOrder; today: string; tv: boolean }) {
  const d = o.column === 'shipped' || o.column === 'packed' ? null : daysLeft(o.deadline_day, today)
  return (
    <Link href={`/production-app/orders?tab=history&q=${encodeURIComponent(o.no)}`}
      className={`block bg-white border rounded-xl p-3 hover:border-[#111110] transition-colors ${o.overdue_days > 0 ? 'border-[#e8b4ad]' : 'border-[#e4e4e0]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={`font-semibold text-[#111110] ${tv ? 'text-[18px]' : 'text-[14px]'}`}>
            № {o.no}{o.urgent && <span className="ml-1.5 text-[11px] font-semibold text-[#c0392b]">🔥 срочно</span>}
          </div>
          <div className={`text-[#3b3b38] truncate ${tv ? 'text-[15px]' : 'text-[12px]'}`}>{o.client || 'Без заказчика'}</div>
        </div>
        {o.column !== 'shipped' && o.column !== 'packed' && (
          <div className="text-right shrink-0">
            <div className={`font-extrabold leading-none tabular-nums ${daysTone(d)} ${tv ? 'text-[34px]' : 'text-[26px]'}`}>
              {d === null ? '—' : d < 0 ? `−${-d}` : d}
            </div>
            <div className="text-[10px] text-[#9a9a95] mt-0.5">{d === null ? 'срок не указан' : d < 0 ? 'дн. просрочки' : d === 0 ? 'отгрузка сегодня' : 'дн. до отгрузки'}</div>
          </div>
        )}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 text-[11px] text-[#6b6b66] tabular-nums">
        <span>Запуск: <b className="text-[#111110] font-medium">{ddmm(o.launch_day)}</b></span>
        <span>{o.column === 'shipped' ? 'Отгружен' : 'Отгрузка'}: <b className="text-[#111110] font-medium">{ddmm(o.column === 'shipped' ? o.ship_day : o.deadline_day)}</b></span>
        <span>Изделий: <b className="text-[#111110] font-medium">{o.pieces}</b></span>
        <span>Операций: <b className="text-[#111110] font-medium">{o.ops_done} из {o.ops_total}</b></span>
      </div>
      {o.materials.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {o.materials.map(m => (
            <li key={`${m.kind}${m.name}${m.thickness}`} className={`text-[11px] leading-snug ${m.kind === 'Зеркало' ? 'text-[#2c5d8a]' : 'text-[#3b3b38]'}`}>
              {materialLine(m)} <span className="text-[#9a9a95]">· {m.pieces} шт.</span>
            </li>
          ))}
        </ul>
      )}
      {o.problem && <div className="mt-1.5 text-[11px] font-medium text-[#c0392b]">⚠ проблема на этапе</div>}
    </Link>
  )
}

export default function OrdersKanban({ tv }: { tv: boolean }) {
  const [data, setData] = useState<Resp | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')

  useEffect(() => {
    let alive = true
    loadJson<Resp>('/api/production/orders-board').then(res => {
      if (!alive) return
      if (res.error !== null) { setErr(res.error); return }
      setErr(null)
      setData(res.data)
    })
    return () => { alive = false }
  }, [tick])

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), tv ? 30_000 : 60_000)
    return () => clearInterval(t)
  }, [tv])

  const columns = useMemo(() => {
    const by = new Map<KanbanColumn, BoardOrder[]>(KANBAN_COLUMNS.map(c => [c.key, []]))
    if (!data) return by
    for (const o of data.orders) {
      if (!onKanban(o, data.today) || !kanbanMatch(o, q)) continue
      by.get(o.column)?.push(o)
    }
    for (const [k, list] of by) by.set(k, kanbanSort(list))
    return by
  }, [data, q])

  // Пустые колонки редких этапов (фацет, триплекс) не занимают место; основные видны всегда.
  const ALWAYS = new Set<KanbanColumn>(['new', 'cutting', 'polishing', 'tempering', 'packaging', 'packed', 'shipped'])
  const visible = KANBAN_COLUMNS.filter(c => ALWAYS.has(c.key) || (columns.get(c.key)?.length ?? 0) > 0)

  if (err) return <div className="p-4 text-[13px] text-[#c0392b]">Не удалось загрузить заказы: {err}. <button className="underline" onClick={() => setTick(n => n + 1)}>Повторить</button></div>
  if (!data) return <div className="p-4 text-[13px] text-[#9a9a95]">Загружаю заказы…</div>

  const total = visible.reduce((n, c) => n + (columns.get(c.key)?.length ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: номер, заказчик, материал"
          className="w-full sm:w-80 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] bg-white" />
        <span className="text-[12px] text-[#9a9a95]">
          {q ? `найдено ${total}` : `${total} заказов`} · заказ стоит на самом раннем этапе, где у него есть незакрытая деталь · отгруженные — за {SHIPPED_SHOW_DAYS} дней
        </span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {visible.map(c => {
            const list = columns.get(c.key) ?? []
            return (
              <section key={c.key} className={`${tv ? 'w-80' : 'w-64'} shrink-0 bg-[#f0f0ec] rounded-xl p-2 flex flex-col`}>
                <h2 className="flex items-center justify-between px-1 pb-2 text-[13px] font-semibold text-[#111110]">
                  {c.label}<span className="text-[12px] font-medium text-[#6b6b66] tabular-nums">{list.length}</span>
                </h2>
                <div className="space-y-2 max-h-[75vh] overflow-y-auto">
                  {list.length === 0 ? <div className="px-1 py-3 text-[12px] text-[#9a9a95]">Пусто</div>
                    : list.map(o => <Card key={o.id} o={o} today={data.today} tv={tv} />)}
                </div>
              </section>
            )
          })}
        </div>
      </div>
      <p className="text-[11px] text-[#9a9a95]">Крупная цифра — дней до отгрузки, красная — просрочка. Карточка переезжает дальше, когда цех отметит этап у всех деталей заказа.</p>
    </div>
  )
}
