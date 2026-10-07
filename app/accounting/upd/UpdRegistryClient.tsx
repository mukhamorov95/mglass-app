'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast, loadJson, responseError, NETWORK_ERROR } from '@/lib/toast'
import { confirmDialog } from '@/lib/dialog'
import { moscowDate, nextUpdNumber } from '@/lib/b2b/updView'
import type { UpdSeriesState } from '@/lib/b2b/updRegistry'
import type { UpdRegistryRow, UpdRegistryTotals } from '@/lib/b2b/updRegistryCsv'
import type { UpdQueue } from '@/lib/b2b/updQueue'

// «Бухгалтерия → УПД» (этап 8 docs/b2b/ORDER_PANEL_ROUTE.md): серия номеров на год, реестр
// выданных за месяц с выгрузкой для книги продаж и «ждут УПД» после переключения.

type Data = {
  pendingSql: boolean
  from: string
  to: string
  today: string
  series: UpdSeriesState[]
  rows: UpdRegistryRow[]
  totals: UpdRegistryTotals | null
  gaps: number[]
  queue: (UpdQueue & { switchDay: string }) | null
}

const money2 = (n: number) => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}
const fmtDateTime = (s: string) => new Date(s).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

const monthTitle = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const card = 'bg-white rounded-2xl border border-[#e4e4e0] p-4 sm:p-5'
const btn = 'text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] bg-white text-[#6b6b66] hover:text-[#111110] hover:border-[#111110] transition-colors'

export default function UpdRegistryClient({ canOpenOrders }: { canOpenOrders: boolean }) {
  const [month, setMonth] = useState(() => moscowDate().slice(0, 7))
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seriesYear, setSeriesYear] = useState(() => Number(moscowDate().slice(0, 4)))
  const [startInput, setStartInput] = useState('')
  const [saving, setSaving] = useState(false)

  const { from, to } = monthBounds(month)

  const [reload, setReload] = useState(0)

  useEffect(() => {
    let alive = true
    loadJson<Data>(`/api/accounting/upd?from=${from}&to=${to}`).then(r => {
      if (!alive) return
      if (r.error || !r.data) setError(r.error ?? 'Реестр не загрузился')
      else { setData(r.data); setError(null) }
    })
    return () => { alive = false }
  }, [from, to, reload])
  const load = () => { setError(null); setReload(n => n + 1) }
  // Пока не пришёл ответ за выбранный месяц, старый реестр не показываем под новым заголовком.
  const loading = !error && data?.from !== from

  const thisYear = data ? Number(data.today.slice(0, 4)) : Number(moscowDate().slice(0, 4))
  const target = data?.series.find(s => s.year === seriesYear) ?? null
  const locked = !!target && target.issued > 0

  async function saveSeries() {
    const start = Number(startInput.trim())
    if (!Number.isInteger(start) || start < 1) { toast.error('Первый номер — целое число от 1'); return }
    const ok = await confirmDialog({
      title: target
        ? `Сменить первый номер серии ${seriesYear} с № ${target.start_number} на № ${start}?`
        : `Включить нумерацию УПД на ${seriesYear} год с № ${start}?`,
      text: target
        ? 'Первый номер меняется, пока в году не выдан ни один УПД.'
        : 'С этого момента УПД выдаются в приложении. В программе их больше не выписывают — иначе номера совпадут. ' +
          'Номер должен быть следующим после последнего УПД из программы. Пока не выдан ни один УПД, номер можно поправить.',
      confirmLabel: target ? 'Сменить' : 'Включить',
    })
    if (!ok) return
    setSaving(true)
    try {
      const r = await fetch('/api/accounting/upd/series', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: seriesYear, start }),
      })
      if (!r.ok) { toast.error('Серия не сохранена', { detail: await responseError(r) }); return }
      toast.success(`Серия ${seriesYear}: первый номер № ${start}`, {
        detail: 'Менеджеры выдают УПД на странице УПД заказа; выданные появятся здесь, в реестре.',
      })
      setStartInput('')
      load()
    } catch {
      toast.error('Серия не сохранена', { detail: NETWORK_ERROR })
    } finally {
      setSaving(false)
    }
  }

  const q = data?.queue ?? null
  const exportHref = (format: 'csv' | 'xlsx') => `/api/accounting/upd?from=${from}&to=${to}&format=${format}`

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-16">
      <div className="bg-white border-b border-[#e4e4e0] px-4 py-5">
        <div className="max-w-[960px] mx-auto">
          <Link href="/accounting" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">‹ Бухгалтерия</Link>
          <h1 className="text-[20px] font-bold text-[#111110] tracking-tight mt-1">УПД</h1>
          <p className="text-[13px] text-[#6b6b66] mt-0.5">Серия номеров, реестр выданных для книги продаж, заказы, которые ждут УПД.</p>
        </div>
      </div>

      <div className="max-w-[960px] mx-auto px-4 pt-4 space-y-4">
        {error && (
          <div className="px-4 py-3 rounded-xl border border-red-200 bg-red-50 text-[13px] text-red-700">
            {error} <button onClick={load} className="underline ml-1">Повторить</button>
          </div>
        )}

        {data?.pendingSql && (
          <div className="px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 text-[13px] text-amber-800">
            Раздел включится после SQL владельца (<code>20261007_upd_registry.sql</code>). До этого УПД выписывает программа,
            а в приложении у заказа — только черновик без номера.
          </div>
        )}

        {/* Серия */}
        <section className={card}>
          <h2 className="text-[15px] font-semibold text-[#111110]">Серия номеров</h2>
          {data && data.series.length > 0 ? (
            <ul className="mt-2 space-y-1.5">
              {data.series.map(s => (
                <li key={s.year} className="text-[13px] text-[#111110]">
                  <b>{s.year}:</b> первый № {s.start_number}
                  <span className="text-[#6b6b66]">
                    {' '}· задан {fmtDateTime(s.set_at)}{s.set_by_name ? `, ${s.set_by_name}` : ''}
                    {' '}· выдано {s.issued}
                    {s.last_number != null && s.last_date ? `, последний № ${s.last_number} от ${fmtDay(s.last_date)}` : ''}
                    {' '}· следующий № {nextUpdNumber(s.start_number, s.last_number)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[#6b6b66] mt-2 leading-relaxed">
              Нумерация в приложении не включена: УПД выписывает программа, менеджеры видят только черновики.
              В день переключения выпишите в программе последний УПД и введите здесь его номер + 1.
              После этого УПД выдаются только в приложении.
            </p>
          )}

          {data && data.gaps.length > 0 && (
            <div className="mt-3 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 text-[12px] text-amber-800">
              В серии {thisYear} нет номеров: {data.gaps.join(', ')}{data.gaps.length >= 50 ? ' и дальше' : ''}.
              Это УПД, выписанные мимо приложения, или пропуск — проверьте до сдачи книги продаж.
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-[#6b6b66] flex flex-col gap-1">
              Год
              <select value={seriesYear} onChange={e => setSeriesYear(Number(e.target.value))}
                className="text-[13px] h-9 px-2 rounded-lg border border-[#e4e4e0] bg-white text-[#111110] outline-none">
                {[thisYear, thisYear + 1].map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label className="text-[12px] text-[#6b6b66] flex flex-col gap-1">
              Первый номер
              <input inputMode="numeric" value={startInput} onChange={e => setStartInput(e.target.value.replace(/\D/g, ''))}
                placeholder={target ? String(target.start_number) : 'напр. 533'} disabled={locked || !data || data.pendingSql}
                className="text-[13px] h-9 w-[140px] px-2 rounded-lg border border-[#e4e4e0] bg-white text-[#111110] outline-none disabled:bg-[#f5f5f3]" />
            </label>
            <button onClick={saveSeries} disabled={saving || locked || !startInput || !data || data.pendingSql}
              className="h-9 text-[13px] font-semibold px-4 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? 'Сохраняю…' : target ? 'Сменить первый номер' : 'Включить нумерацию'}
            </button>
            {locked && (
              <span className="text-[12px] text-[#6b6b66] pb-2">В {seriesYear} году УПД уже выдавались — первый номер закреплён.</span>
            )}
          </div>
        </section>

        {/* Реестр */}
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[#111110] mr-auto">Реестр выданных</h2>
            <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)}
              className="text-[13px] h-9 px-2 rounded-lg border border-[#e4e4e0] bg-white text-[#111110] outline-none" />
            {data && !data.pendingSql && !loading && (
              <>
                <a href={exportHref('xlsx')} download className={btn}>⬇ Excel</a>
                <a href={exportHref('csv')} download className={btn}>⬇ CSV</a>
              </>
            )}
          </div>
          <p className="text-[12px] text-[#9a9a95] mt-1">
            По дате УПД, за {monthTitle(month)}. Excel — для чтения (ИНН с ведущим нулём не теряется), CSV — для загрузки в программу.
          </p>

          {loading ? (
            <p className="text-[13px] text-[#9a9a95] mt-4">Загружаю…</p>
          ) : data && data.rows.length === 0 ? (
            <p className="text-[13px] text-[#6b6b66] mt-4">
              {data.pendingSql ? 'Реестр появится после SQL владельца.' : `За ${monthTitle(month)} УПД из приложения не выдавались.`}
            </p>
          ) : data && (
            <div className="mt-3 -mx-4 sm:mx-0 overflow-x-auto">
              <table className="w-full min-w-[760px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                    <th className="py-2 pl-4 sm:pl-0 pr-2 font-medium">№</th>
                    <th className="py-2 pr-2 font-medium">Дата</th>
                    <th className="py-2 pr-2 font-medium">Покупатель</th>
                    <th className="py-2 pr-2 font-medium">ИНН / КПП</th>
                    <th className="py-2 pr-2 font-medium text-right">Без НДС</th>
                    <th className="py-2 pr-2 font-medium text-right">НДС</th>
                    <th className="py-2 pr-2 font-medium text-right">С НДС</th>
                    <th className="py-2 pr-2 font-medium">Заказ</th>
                    <th className="py-2 pr-4 sm:pr-0" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(r => (
                    <tr key={`${r.year}-${r.number}`} className="border-b border-[#f0f0ec] align-top">
                      <td className="py-2 pl-4 sm:pl-0 pr-2 font-semibold text-[#111110] tabular-nums">{r.number}</td>
                      <td className="py-2 pr-2 tabular-nums">{fmtDay(r.doc_date)}</td>
                      <td className="py-2 pr-2 text-[#111110]">{r.buyer_name}</td>
                      <td className="py-2 pr-2 tabular-nums text-[#6b6b66]">{r.buyer_inn}{r.buyer_kpp ? ` / ${r.buyer_kpp}` : ''}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{money2(r.sum_no_vat)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{money2(r.vat)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap font-medium">{money2(r.sum_inc_vat)}</td>
                      <td className="py-2 pr-2 tabular-nums text-[#6b6b66]">{r.order_number ?? r.b2b_order_id}</td>
                      <td className="py-2 pr-4 sm:pr-0 text-right">
                        <Link href={`/accounting/upd/${r.b2b_order_id}`} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">🖨 Печать</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {data.totals && (
                  <tfoot>
                    <tr className="font-semibold text-[#111110]">
                      <td colSpan={4} className="py-2 pl-4 sm:pl-0 pr-2">Итого: {data.totals.count} УПД</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{money2(data.totals.sumNoVat)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{money2(data.totals.vat)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">{money2(data.totals.sumIncVat)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </section>

        {/* Ждут УПД */}
        {q && (
          <section className={card}>
            <h2 className="text-[15px] font-semibold text-[#111110]">Ждут УПД · {q.rows.length}</h2>
            <p className="text-[12px] text-[#9a9a95] mt-1">
              Отгружено с {fmtDay(q.switchDay)} (включение серии), УПД ещё не выдан. Выдаёт менеджер на странице УПД заказа.
            </p>
            {q.rows.length === 0 ? (
              <p className="text-[13px] text-[#6b6b66] mt-3">Все отгрузки с ИНН закрыты УПД.</p>
            ) : (
              <ul className="mt-3 divide-y divide-[#f0f0ec]">
                {q.rows.map(r => (
                  <li key={r.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
                    {canOpenOrders
                      ? <Link href={`/b2b-quotes/${r.id}/upd`} className="font-semibold text-blue-600 hover:underline tabular-nums">{r.ref}</Link>
                      : <span className="font-semibold text-[#111110] tabular-nums">{r.ref}</span>}
                    <span className="text-[#111110]">{r.client}</span>
                    <span className="text-[#6b6b66]">отгружен {fmtDay(r.shippedDay)}</span>
                    <span className="ml-auto tabular-nums text-[#111110]">{money2(r.total)} ₽</span>
                  </li>
                ))}
              </ul>
            )}
            {(q.noInn > 0 || q.undated > 0) && (
              <p className="text-[12px] text-[#6b6b66] mt-3">
                {q.noInn > 0 && `Ещё ${q.noInn} отгружено клиентам без ИНН — УПД им не выдаётся. `}
                {q.undated > 0 && `${q.undated} отмечено «Отгружен» без даты — дату УПД выбирают при выдаче.`}
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
