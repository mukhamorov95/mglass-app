'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { mskDateTime } from '@/lib/time'
import { orphanTitle, orphanSpec, orphanTotal, productLabel, lyingFor, type OrphanCalc } from '@/lib/b2c/myDay'

const RUB = (v: number | string | null | undefined) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`

type Counts = { active: number; archived: number }

// Расчёты, не привязанные к сделке. Быстрый расчёт разрешает считать без клиента —
// и такой расчёт исчезал: в воронку не попадал, найти его было негде.
//
// Здесь у него три выхода, и все три видны: привязать к клиенту (два поля),
// открыть и посмотреть, что посчитано, или убрать в архив. Архив — не удаление:
// расчёт остаётся в «Расчётах», и его можно вернуть.
export function OrphanCalcs() {
  const [view, setView] = useState<'active' | 'archive'>('active')
  const [items, setItems] = useState<OrphanCalc[] | null>(null)
  const [counts, setCounts] = useState<Counts>({ active: 0, archived: 0 })
  const [openId, setOpenId] = useState<number | null>(null)
  const [seenId, setSeenId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback((v: 'active' | 'archive') => {
    fetch(`/api/calculations/orphans?view=${v}`)
      .then(r => r.json())
      .then(j => {
        setItems(Array.isArray(j?.items) ? j.items : [])
        if (j?.counts) setCounts(j.counts)
      })
      .catch(() => setItems([]))
  }, [])

  useEffect(() => { load(view) }, [load, view])

  function open(o: OrphanCalc) {
    setOpenId(o.id)
    setName(o.client_name ?? '')
    setPhone(o.client_phone ?? '')
    setAddress('')
    setMsg(null)
  }

  async function attach(calcId: number) {
    if (name.trim().length < 2 || phone.replace(/\D/g, '').length < 10) {
      setMsg('Нужно имя и телефон'); return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/deals/ensure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calc_id: calcId, client_name: name.trim(), phone: phone.trim(), address: address.trim() }),
      }).then(x => x.json()).catch(() => null)

      if (r?.created) {
        setItems(prev => (prev ?? []).filter(i => i.id !== calcId))
        setCounts(c => ({ ...c, active: Math.max(0, c.active - 1) }))
        setOpenId(null)
      } else if (r?.ambiguous) {
        // Такой телефон уже есть в другой сделке — склеивать молча нельзя.
        setMsg('Такой телефон уже есть в сделке. Откройте «Сделки» и добавьте расчёт туда.')
      } else {
        setMsg(r?.error ?? 'Не получилось завести сделку')
      }
    } finally { setBusy(false) }
  }

  async function archive(ids: number[], archived: boolean) {
    if (ids.length === 0) return
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/calculations/orphans/archive', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, archived }),
      }).then(x => x.json()).catch(() => null)
      const changed: number[] = Array.isArray(r?.changed) ? r.changed : []
      if (changed.length === 0) { setMsg(r?.error ?? 'Не получилось — расчёт чужой или уже привязан'); return }
      setItems(prev => (prev ?? []).filter(i => !changed.includes(i.id)))
      setCounts(c => archived
        ? { active: Math.max(0, c.active - changed.length), archived: c.archived + changed.length }
        : { active: c.active + changed.length, archived: Math.max(0, c.archived - changed.length) })
      setOpenId(null); setSeenId(null)
    } finally { setBusy(false) }
  }

  if (items == null) return null
  if (counts.active === 0 && counts.archived === 0) return null

  const list = items
  const total = orphanTotal(list)
  const archiveView = view === 'archive'

  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e4e4e0] flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[#111110]">
            {archiveView ? `Архив расчётов · ${counts.archived}` : `Расчёты без клиента · ${counts.active}`}
          </p>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">
            {archiveView
              ? 'Убраны из списка дел. Сам расчёт цел — можно открыть или вернуть.'
              : 'Посчитано, но ни в какую сделку не попало — впишите имя и телефон, иначе расчёт потеряется.'}
          </p>
          {/* Итог раскрывается: видно, из скольких расчётов и на какую сумму он сложен. */}
          {total.count > 0 && (
            <p className="text-[11px] text-[#c4c4be] mt-0.5">
              {total.count} на экране на {RUB(total.sum)}
              {total.withSum < total.count && ` (у ${total.count - total.withSum} суммы нет)`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!archiveView && list.length > 0 && (
            <button onClick={() => archive(list.map(i => i.id), true)} disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#4b4b47] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40">
              Все в архив
            </button>
          )}
          <button onClick={() => { setView(archiveView ? 'active' : 'archive'); setItems(null); setOpenId(null); setSeenId(null); setMsg(null) }}
            className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">
            {archiveView ? '← К списку' : `Архив · ${counts.archived}`}
          </button>
        </div>
      </div>

      {msg && <p className="px-4 py-2 text-[12px] text-[#c2410c] border-b border-[#f0f0ec]">{msg}</p>}

      {list.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-[#9a9a95]">
          {archiveView ? 'В архиве пусто.' : 'Все расчёты привязаны к клиентам.'}
        </p>
      ) : (
        <div className="divide-y divide-[#f0f0ec]">
          {list.map(o => {
            const spec = orphanSpec(o)
            const seen = seenId === o.id
            return (
              <div key={o.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <button onClick={() => setSeenId(seen ? null : o.id)} className="min-w-0 text-left flex-1">
                    <p className="text-[13px] text-[#111110] truncate">{orphanTitle(o)}</p>
                    <p className="text-[12px] text-[#9a9a95]">
                      {mskDateTime(o.created_at)} · {RUB(o.final_price)} · {productLabel(o.product_type)}
                      {o.created_by_name && ` · ${o.created_by_name}`}
                    </p>
                    {/* Раскрывается всегда: даже когда описания нет, внутри ссылка
                        в карточку расчёта — там параметры и состав себестоимости. */}
                    <p className="text-[11px] text-[#c4c4be] mt-0.5">
                      {seen ? 'свернуть' : 'что посчитано ▾'}
                      {!archiveView && ` · ${lyingFor(o.created_at)}`}
                    </p>
                  </button>
                  <div className="flex items-center gap-2 shrink-0">
                    {archiveView ? (
                      <button onClick={() => archive([o.id], false)} disabled={busy}
                        className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:bg-[#f5f5f3] disabled:opacity-40">
                        Вернуть
                      </button>
                    ) : (
                      <>
                        <button onClick={() => archive([o.id], true)} disabled={busy}
                          className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40">
                          В архив
                        </button>
                        <button onClick={() => (openId === o.id ? setOpenId(null) : open(o))}
                          className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:bg-[#f5f5f3]">
                          {openId === o.id ? 'Закрыть' : 'Привязать'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {seen && (
                  <div className="mt-2 rounded-lg bg-[#fafaf9] border border-[#f0f0ec] px-3 py-2">
                    {spec.length > 0 ? (
                      <p className="text-[12px] text-[#4b4b47] whitespace-pre-wrap leading-relaxed">{spec.join('\n')}</p>
                    ) : (
                      <p className="text-[12px] text-[#9a9a95]">
                        Кроме названия, в расчёте ничего не записано. Параметры и состав — в карточке расчёта.
                      </p>
                    )}
                    {o.client_phone && <p className="text-[12px] text-[#4b4b47] mt-1">Телефон в расчёте: {o.client_phone}</p>}
                    <Link href={`/calculations/${o.id}`}
                      className="inline-block mt-2 text-[12px] font-medium text-[#111110] underline underline-offset-2">
                      Открыть расчёт #{o.id} →
                    </Link>
                  </div>
                )}

                {openId === o.id && !archiveView && (
                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя клиента"
                      className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                    <div className="grid grid-cols-2 gap-2">
                      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон" inputMode="tel"
                        className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                      <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес (необязательно)"
                        className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                    </div>
                    <button onClick={() => attach(o.id)} disabled={busy}
                      className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                      {busy ? 'Завожу…' : 'Завести сделку'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
