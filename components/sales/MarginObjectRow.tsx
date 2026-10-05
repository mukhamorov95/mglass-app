'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/lib/dialog'
import { COST_KEYS, COST_RU, REQUIRED_COSTS, type CostKey, type SaleEdits } from '@/lib/sales/marginFields.mjs'

// Строка объекта на «Марже»: по нажатию раскрывается карточка со всеми ячейками книги
// в её порядке. Серое — из книги «Маржа», чёрное — внесено в приложении; пустое поле
// возвращает значение книги. «Есть несохранённое» — сравнением с сохранённым, черновик
// живёт в localStorage до сохранения или «Отменить правки».

export type MarginRowData = {
  saleId: number | null
  orderNo: string | null
  client: string | null
  manager: string | null
  closed: boolean
  needsCosts: boolean     // закрыт по статусу, но расходы внесены не все — в маржу не входит
  bookClosed: boolean
  amount: number
  partnerFee: number
  varTotal: number | null
  md: number | null
  mdPct: number | null
  issue: string
  book: Record<CostKey, number | null> | null
  edits: SaleEdits
}

type Draft = { costs: Record<CostKey, string>; closed: boolean }

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const pct1 = (n: number) => Math.round(n * 10) / 10
const pct = (n: number | null) => (n == null ? '—' : `${pct1(n).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`)
const mCls = (n: number | null) =>
  n == null ? 'text-[#9a9a95]' : pct1(n) < 25 ? 'text-red-600' : pct1(n) < 35 ? 'text-amber-600' : 'text-emerald-700'
const parse = (s: string): number | null => {
  const t = s.replace(/\s/g, '').replace(',', '.')
  if (!t) return null
  const n = Number(t.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
const show = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ru-RU'))
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' })
const label = (k: CostKey) => COST_RU[k][0].toUpperCase() + COST_RU[k].slice(1)
const key = (id: number) => `mglass.margin-draft.v1.${id}`

function savedDraft(d: MarginRowData): Draft {
  return {
    costs: Object.fromEntries(COST_KEYS.map(k => [k, show(d.edits[k]?.value)])) as Record<CostKey, string>,
    closed: d.edits.closed ? d.edits.closed.value === 1 : d.bookClosed,
  }
}

export default function MarginObjectRow({ d }: { d: MarginRowData }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(() => savedDraft(d))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const saved = useMemo(() => savedDraft(d), [d])

  // Черновик прошлого захода — после монтирования: на сервере localStorage нет.
  useEffect(() => {
    if (d.saleId == null) return
    try {
      const raw = window.localStorage.getItem(key(d.saleId))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) { setDraft(JSON.parse(raw) as Draft); setOpen(true) }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changed = COST_KEYS.filter(k => parse(draft.costs[k]) !== (d.edits[k]?.value ?? null))
  const closedChanged = draft.closed !== saved.closed
  const dirty = changed.length > 0 || closedChanged

  useEffect(() => {
    if (d.saleId == null) return
    try {
      if (dirty) window.localStorage.setItem(key(d.saleId), JSON.stringify(draft))
      else window.localStorage.removeItem(key(d.saleId))
    } catch {}
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, draft, d.saleId])

  // Пересчёт на лету тем же правилом, что сервер: внесённое сильнее книги,
  // партнёрские — бо́льшие из «Маржи» и «Продаж».
  const eff = Object.fromEntries(COST_KEYS.map(k => [k, parse(draft.costs[k]) ?? d.book?.[k] ?? null])) as Record<CostKey, number | null>
  const partners = Math.max(eff.partners ?? 0, d.partnerFee)
  const total = COST_KEYS.reduce((s, k) => s + (k === 'partners' ? partners : eff[k] ?? 0), 0)
  const md = d.amount - total
  const mdPct = d.amount ? md / d.amount * 100 : null
  const missing = REQUIRED_COSTS.filter(k => eff[k] == null)

  async function save() {
    if (d.saleId == null) return
    setBusy(true); setMsg(null)
    const set: Record<string, number> = {}
    const clear: string[] = []
    for (const k of changed) {
      const v = parse(draft.costs[k])
      if (v == null) clear.push(k)
      else set[k] = v
    }
    if (closedChanged) {
      if (draft.closed === d.bookClosed) clear.push('closed')
      else set.closed = draft.closed ? 1 : 0
    }
    try {
      const r = await fetch('/api/margin/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ saleId: d.saleId, set, clear }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `ошибка ${r.status}`)
      const what = [...changed.map(k => COST_RU[k]), ...(closedChanged ? [draft.closed ? 'закрыт' : 'не закрыт'] : [])].join(', ')
      setMsg({
        ok: true,
        text: `Сохранено: ${what} — заказ ${d.orderNo ?? ''}. Маржа объекта и месяца пересчитана на этой странице${j.financeError ? `; себестоимость для CFO обновится утром (${j.financeError})` : ', себестоимость для CFO обновлена'}. Правка записана в журнал действий.`,
      })
      try { window.localStorage.removeItem(key(d.saleId)) } catch {}
      router.refresh()
    } catch (e) {
      setMsg({ ok: false, text: `Не сохранилось: ${(e as Error).message}. Правки остались в карточке.` })
    } finally {
      setBusy(false)
    }
  }

  async function discard() {
    if (!(await confirmDialog({
      title: `Отменить правки по заказу ${d.orderNo ?? ''}?`,
      text: 'Поля вернутся к сохранённым значениям.',
      confirmLabel: 'Отменить правки',
      danger: true,
    }))) return
    setDraft(saved)
    setMsg(null)
  }

  const edited = Object.keys(d.edits).length > 0
  return (
    <Fragment>
      <tr onClick={() => setOpen(v => !v)}
        className={`border-b border-[#f5f5f3] last:border-0 align-top cursor-pointer hover:bg-[#fafaf8] ${open ? 'bg-[#fafaf8]' : ''}`}>
        <td className="px-3 py-1.5 font-medium text-[#111110]">
          <span className="inline-block w-3 text-[#9a9a95]">{open ? '▾' : '▸'}</span>{d.orderNo ?? '—'}
          {edited && <span className="text-[#0071e3]" title="есть ячейки, внесённые в приложении"> ✎</span>}
          {dirty && <span className="text-amber-600" title="есть несохранённые правки"> •</span>}
        </td>
        <td className="px-3 py-1.5 max-w-[220px] truncate" title={d.client ?? ''}>{d.client ?? '—'}<span className="text-[#9a9a95]"> · {d.manager ?? '—'}</span></td>
        <td className="px-3 py-1.5">{d.saleId == null ? <span className="text-[#9a9a95]">нет в продажах</span> : d.needsCosts ? <span className="text-amber-700">закрыт · дописать</span> : d.closed ? 'закрыт' : <span className="text-[#9a9a95]">в работе</span>}</td>
        <td className="px-3 py-1.5 text-right">{rub(d.amount)}</td>
        <td className="px-3 py-1.5 text-right">{d.varTotal == null ? '—' : rub(d.varTotal)}</td>
        <td className="px-3 py-1.5 text-right font-semibold">{d.md == null ? '—' : rub(d.md)}</td>
        <td className={`px-3 py-1.5 text-right font-semibold ${mCls(d.mdPct)}`}>{pct(d.mdPct)}</td>
        <td className="px-3 py-1.5 text-[#6b6b66] whitespace-normal min-w-[220px]">{d.issue}</td>
      </tr>
      {open && (
        <tr className="border-b border-[#e4e4e0] bg-[#fcfcfb]">
          <td colSpan={8} className="px-3 py-3 whitespace-normal">
            {d.saleId == null ? (
              <p className="text-[12px] text-[#6b6b66]">Этого номера нет в «Продажах M-Glass» — править нечего, пока номер в книге «Маржа» не совпадёт с продажей.</p>
            ) : (
              <div className="space-y-3 max-w-[860px]">
                <p className="text-[12px] text-[#6b6b66]">
                  Заказ <b className="text-[#111110]">{d.orderNo}</b> · {d.client ?? '—'} · {d.manager ?? '—'} · продажа <b className="text-[#111110]">{rub(d.amount)} ₽</b>.
                  Серым — значение из книги «Маржа»; впишите своё, чтобы заменить, или очистите поле, чтобы вернуть книжное. Если расхода не было — поставьте 0.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
                  {COST_KEYS.map(k => {
                    const book = d.book?.[k] ?? null
                    const e = d.edits[k]
                    const mine = parse(draft.costs[k])
                    return (
                      <label key={k} className="block" onClick={ev => ev.stopPropagation()}>
                        <span className="text-[11px] text-[#6b6b66]">
                          {label(k)}{REQUIRED_COSTS.includes(k) && <span className="text-amber-700" title="должно быть заполнено, хотя бы нулём"> *</span>}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <input inputMode="decimal" value={draft.costs[k]}
                            placeholder={book == null ? 'пусто в книге' : show(book)}
                            onChange={ev => { const v = ev.target.value.replace(/[^\d\s.,]/g, ''); setDraft(x => ({ ...x, costs: { ...x.costs, [k]: v } })); setMsg(null) }}
                            className={`w-full border rounded-lg px-2.5 py-1.5 text-[13px] text-right tabular-nums ${mine == null && book == null && REQUIRED_COSTS.includes(k) ? 'border-amber-300 bg-amber-50/40' : 'border-[#e4e4e0] bg-white'}`} />
                          <span className="text-[12px] text-[#6b6b66]">₽</span>
                        </div>
                        <span className="block text-[11px] leading-snug mt-0.5 text-[#9a9a95]">
                          {e ? <>внесено: {e.by ?? '—'}, {when(e.at)}{book != null && book !== e.value && <span className="text-amber-700"> · в книге {rub(book)}</span>}</>
                            : book != null ? 'из книги' : 'в книге пусто'}
                          {k === 'partners' && d.partnerFee > (eff.partners ?? 0) && <span className="text-amber-700"> · в «Продажах» {rub(d.partnerFee)} — считаем их</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
                <label className="flex items-center gap-2 text-[13px] text-[#111110]" onClick={ev => ev.stopPropagation()}>
                  <input type="checkbox" checked={draft.closed} onChange={ev => { const v = ev.target.checked; setDraft(x => ({ ...x, closed: v })); setMsg(null) }} />
                  Объект закрыт
                  <span className="text-[11px] text-[#9a9a95]">
                    по «Продажам M-Glass»: {d.bookClosed ? 'закрыт' : 'в работе'}{d.edits.closed && ` · отмечено: ${d.edits.closed.by ?? '—'}, ${when(d.edits.closed.at)}`}
                  </span>
                </label>
                <p className="text-[13px] text-[#111110]">
                  Расходы <b>{rub(total)} ₽</b> · маржа <b>{rub(md)} ₽</b> · <b className={mCls(mdPct)}>{pct(mdPct)}</b>
                  {missing.length > 0 && <span className="text-amber-700 text-[12px]"> · не внесено: {missing.map(k => COST_RU[k]).join(', ')} — маржа завышена</span>}
                </p>
                <div className="flex items-center gap-3 flex-wrap" onClick={ev => ev.stopPropagation()}>
                  <button onClick={save} disabled={!dirty || busy}
                    className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
                    {busy ? 'Сохраняю…' : dirty ? `Сохранить (${changed.length + (closedChanged ? 1 : 0)})` : 'Изменений нет'}
                  </button>
                  {dirty && <button onClick={discard} className="text-[13px] text-[#6b6b66] hover:text-[#111110]">Отменить правки</button>}
                </div>
                {msg && <p className={`text-[12px] leading-snug ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
              </div>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  )
}
