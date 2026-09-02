'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  groupsFieldExisted, managersInPeriod, pct, pivotByManager, pivotByWeek, sumTotals,
  HOLES_GROUPS_SINCE, type QualityRow,
} from '@/lib/b2b/quoteQuality'

// Мерилка обучения менеджеров: сдвинулась ли полнота просчёта после ролика.
// Строится из того, что менеджеры и так делают — считают заказы, — а не из
// просмотров: экран «прошёл курс» мерил бы прилежание, а не результат.

type Resp = { from: string; rows: QualityRow[] }

const PERIODS = [
  { label: 'с 1 июля',    from: '2026-07-01' },
  { label: 'с 1 августа', from: '2026-08-01' },
]

const fmtWeek = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6)
  const f = (x: Date) => `${String(x.getUTCDate()).padStart(2, '0')}.${String(x.getUTCMonth() + 1).padStart(2, '0')}`
  return `${f(d)}–${f(e)}`
}

const share = (part: number, whole: number) => {
  const v = pct(part, whole)
  return v === null ? '—' : `${v}%`
}

export default function QuoteQualityPage() {
  const [from, setFrom] = useState(PERIODS[0].from)
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    const run = async () => {
      setLoading(true); setError(null)
      try {
        const r = await fetch(`/api/admin/quote-quality?from=${from}`)
        if (!alive) return
        if (!r.ok) { setError(r.status === 403 ? 'Только для владельца' : 'Не удалось загрузить'); return }
        const json = await r.json() as Resp
        if (alive) setData(json)
      } catch {
        if (alive) setError('Ошибка сети')
      } finally {
        if (alive) setLoading(false)
      }
    }
    void run()
    return () => { alive = false }
  }, [from])

  const rows     = useMemo(() => data?.rows ?? [], [data])
  const managers = useMemo(() => managersInPeriod(rows), [rows])
  const weeks    = useMemo(() => pivotByWeek(rows, managers), [rows, managers])
  const byMgr    = useMemo(() => pivotByManager(rows), [rows])
  const total    = useMemo(() => sumTotals(rows), [rows])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-[13px] mb-1">
        <Link href="/admin" className="text-[#9a9a95] hover:text-[#6b6b66]">← Админ</Link>
        <span className="text-[#d4d4d0]">/</span>
        <span className="font-semibold text-[#111110]">Полнота просчёта</span>
      </div>
      <h1 className="text-[22px] font-bold text-[#111110]">Видит ли цех работу, которую заложил менеджер</h1>
      <p className="text-[13px] text-[#9a9a95] mt-0.5 mb-4 max-w-2xl">
        Маршрут изделия по цеху строится из признаков просчёта. Не отмечены отверстия — задача
        у сверловщика не появится. Это базовая линия для обучения: меряем то, что менеджеры и так
        делают, а не просмотры ролика.
      </p>

      <div className="flex gap-1.5 mb-4">
        {PERIODS.map(p => (
          <button key={p.from} onClick={() => setFrom(p.from)}
            className={`text-[12px] px-3 py-1.5 rounded-full transition-colors ${
              from === p.from ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[13px] text-[#9a9a95]">Считаем…</p>}
      {error && <p className="text-[13px] text-red-600">{error}</p>}

      {data && !loading && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <Card title="Позиций просчитано" value={String(total.positions)}
                  note={`${total.orders} заказов, архивные не в счёт`} />
            <Card title="Отмечены отверстия" value={share(total.flagged, total.positions)}
                  note={`${total.flagged} из ${total.positions} позиций`} />
            <Card title="Из них расписаны группы ⌀" value={share(total.detailed, total.flagged)}
                  note={`${total.detailed} из ${total.flagged}; поле существует с 28.08`} />
          </div>

          <h2 className="text-[15px] font-semibold text-[#111110] mb-2">По неделям</h2>
          <div className="overflow-x-auto border border-[#e4e4e0] rounded-lg bg-white mb-6">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[#9a9a95] border-b border-[#e4e4e0]">
                  <th className="text-left font-medium px-3 py-2">Неделя</th>
                  <th className="text-right font-medium px-3 py-2">Позиций</th>
                  <th className="text-right font-medium px-3 py-2">Отмечены отверстия</th>
                  <th className="text-right font-medium px-3 py-2">Расписаны группы ⌀</th>
                  <th className="text-right font-medium px-3 py-2">⌀ уже в комментарии</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map(w => (
                  <tr key={w.week} className="border-b border-[#f0f0ec] last:border-0">
                    <td className="px-3 py-2 text-[#111110]">{fmtWeek(w.week)}</td>
                    <td className="px-3 py-2 text-right text-[#111110]">{w.total.positions}</td>
                    <td className="px-3 py-2 text-right text-[#111110]">
                      {w.total.flagged} <span className="text-[#9a9a95]">· {share(w.total.flagged, w.total.positions)}</span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {groupsFieldExisted(w.week)
                        ? <span className="text-[#111110]">{w.total.detailed} <span className="text-[#9a9a95]">· {share(w.total.detailed, w.total.flagged)}</span></span>
                        : <span className="text-[#9a9a95]">поля ещё не было</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[#6b6b66]">{w.total.diam_in_comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="text-[15px] font-semibold text-[#111110] mb-2">По менеджерам за период</h2>
          <div className="overflow-x-auto border border-[#e4e4e0] rounded-lg bg-white mb-6">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[#9a9a95] border-b border-[#e4e4e0]">
                  <th className="text-left font-medium px-3 py-2">Менеджер</th>
                  <th className="text-right font-medium px-3 py-2">Позиций</th>
                  <th className="text-right font-medium px-3 py-2">Заказов</th>
                  <th className="text-right font-medium px-3 py-2">Отмечены отверстия</th>
                  <th className="text-right font-medium px-3 py-2">Расписаны группы ⌀</th>
                  <th className="text-right font-medium px-3 py-2">⌀ уже в комментарии</th>
                </tr>
              </thead>
              <tbody>
                {byMgr.map(m => (
                  <tr key={m.manager} className="border-b border-[#f0f0ec] last:border-0">
                    <td className="px-3 py-2 text-[#111110]">{m.manager}</td>
                    <td className="px-3 py-2 text-right text-[#111110]">{m.total.positions}</td>
                    <td className="px-3 py-2 text-right text-[#6b6b66]">{m.total.orders}</td>
                    <td className="px-3 py-2 text-right text-[#111110]">
                      {m.total.flagged} <span className="text-[#9a9a95]">· {share(m.total.flagged, m.total.positions)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#111110]">
                      {m.total.detailed} <span className="text-[#9a9a95]">· {share(m.total.detailed, m.total.flagged)}</span>
                    </td>
                    <td className="px-3 py-2 text-right text-[#6b6b66]">{m.total.diam_in_comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[12px] text-[#6b6b66] space-y-2 border border-[#e4e4e0] rounded-lg bg-[#f5f5f3] p-4">
            <p className="font-semibold text-[#111110]">Как это читать — три оговорки</p>
            <p>
              <b>Доля отметок — не оценка дисциплины.</b> Сколько изделий на самом деле требуют
              сверловки, система не знает: у стекла без отверстий пустая галка правильная. Цифра
              годится как ряд, который сравнивают сам с собой до и после обучения, а не как «должно
              быть больше».
            </p>
            <p>
              <b>Группы ⌀ существуют с {HOLES_GROUPS_SINCE.split('-').reverse().join('.')}.</b> Ноль в
              неделях до этой даты — свойство релиза, а не работы менеджера, поэтому там стоит
              «поля ещё не было».
            </p>
            <p>
              <b>Последняя колонка меняет диагноз.</b> Диаметры туда пишет разбор чертежа: если они
              есть в комментарии, а поле групп пусто, менеджер не «забыл» — его просят перепечатать
              то, что система уже распознала.
            </p>
            <p>
              <b>Чего этот экран не поймает.</b> Случай 1 сентября — четыре заказа, семь позиций,
              ни признака, ни упоминания в комментарии — в данных не отличим от изделий, которым
              сверловка действительно не нужна. Такой пропуск виден только когда сверловщик придёт
              и скажет. Экран меряет сдвиг, а не ловит каждый промах.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="border border-[#e4e4e0] rounded-lg bg-white p-4">
      <p className="text-[11px] font-medium text-[#9a9a95] uppercase tracking-wider">{title}</p>
      <p className="text-[26px] font-bold text-[#111110] leading-tight mt-1">{value}</p>
      <p className="text-[11px] text-[#9a9a95] mt-0.5">{note}</p>
    </div>
  )
}
