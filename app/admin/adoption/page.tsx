'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { FlowRow, FlowVerdict } from '@/lib/b2b/adoptionAudit'

// Отчёт внедрения для владельца: что построено и используется ли на самом деле.
// Не для разработчика — здесь нет «что чинить», здесь «что внедрять».

type Precondition = { key: string; title: string; value: string; ok: boolean; note?: string }
type Resp = {
  summary: { dead: number; fading: number; alive: number; tooNew: number; unmeasured: number; total: number }
  flows: FlowRow[]
  preconditions?: Precondition[]
  note: string
}

const VERDICT_STYLE: Record<FlowVerdict, { label: string; cls: string }> = {
  'мертва':        { label: 'мертва',            cls: 'bg-red-50 text-red-600 border-red-200' },
  'затухает':      { label: 'затухает',          cls: 'bg-orange-50 text-orange-700 border-orange-200' },
  'живёт':         { label: 'живёт',             cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'ранний старт':  { label: 'ранний старт',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  'слишком новая': { label: 'слишком новая',     cls: 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]' },
  'не измеряется': { label: 'не измеряется',     cls: 'bg-white text-[#9a9a95] border-[#e4e4e0]' },
}

export default function AdoptionPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/adoption')
      .then(async r => {
        if (!r.ok) { setError(r.status === 403 ? 'Только для владельца' : 'Не удалось загрузить'); return }
        setData(await r.json() as Resp)
      })
      .catch(() => setError('Ошибка сети'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-[13px] mb-1">
        <Link href="/admin" className="text-[#9a9a95] hover:text-[#6b6b66]">← Админ</Link>
        <span className="text-[#d4d4d0]">/</span>
        <span className="font-semibold text-[#111110]">Внедрение</span>
      </div>
      <h1 className="text-[22px] font-bold text-[#111110]">Что построено и используется ли</h1>
      <p className="text-[13px] text-[#9a9a95] mt-0.5 mb-4 max-w-2xl">
        Главный вопрос не «что чинить», а «что внедрять». Цифра использования — из данных.
        Где счётчика нет — так и написано, не додумано.
      </p>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : !data ? null : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
            {[
              { v: data.summary.dead, l: 'мертва', tone: 'text-red-600' },
              { v: data.summary.fading, l: 'затухает', tone: 'text-orange-700' },
              { v: data.summary.alive, l: 'живёт', tone: 'text-emerald-700' },
              { v: data.summary.tooNew, l: 'слишком новая', tone: 'text-[#6b6b66]' },
              { v: data.summary.unmeasured, l: 'не измеряется', tone: 'text-[#9a9a95]' },
            ].map(x => (
              <div key={x.l} className="bg-white border border-[#e4e4e0] rounded-2xl px-3 py-2.5 text-center">
                <p className={`text-[20px] font-bold ${x.tone}`}>{x.v}</p>
                <p className="text-[10px] text-[#9a9a95]">{x.l}</p>
              </div>
            ))}
          </div>

          <div className="bg-amber-50/60 border border-amber-200 rounded-xl px-4 py-2.5 mb-4">
            <p className="text-[12px] text-amber-800">{data.note}</p>
          </div>

          {(data.preconditions ?? []).length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a9a95] mb-1.5">Предпосылки</p>
              <div className="space-y-2">
                {data.preconditions!.map(p => (
                  <div key={p.key} className={`border rounded-xl px-4 py-2.5 ${p.ok ? 'bg-emerald-50/50 border-emerald-200' : 'bg-red-50/50 border-red-200'}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-[#111110]">{p.title}</span>
                      <span className={`text-[13px] font-bold font-mono ${p.ok ? 'text-emerald-700' : 'text-red-600'}`}>{p.value}</span>
                    </div>
                    {p.note && <p className="text-[11px] text-[#6b6b66] mt-0.5">{p.note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden divide-y divide-[#f0f0ec]">
            {data.flows.map(f => {
              const vs = VERDICT_STYLE[f.verdict]
              return (
                <div key={f.key} className="px-4 py-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[#111110]">{f.title}</span>
                      <span className="text-[10px] text-[#9a9a95] bg-[#f5f5f3] px-1.5 py-0.5 rounded">{f.domain}</span>
                    </div>
                    <p className="text-[11px] text-[#9a9a95] mt-0.5">
                      выкачено {new Date(f.shipped).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })} · {f.ageDays} дн. назад
                      {f.usesTotal !== null && ` · использований: ${f.usesTotal} (за 30 дн: ${f.uses30d})`}
                    </p>
                    {f.hint && <p className="text-[11px] text-red-600 mt-0.5">{f.hint}</p>}
                    {f.note && !f.hint && <p className="text-[11px] text-[#9a9a95] mt-0.5 italic">{f.note}</p>}
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${vs.cls}`}>
                    {vs.label}
                  </span>
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-[#9a9a95] mt-3">
            «Слишком новая» ≠ провал: фича моложе 14 дней ещё не могла набрать использований.
            Решения владельца — в первую очередь по «мертва» и «затухает».
          </p>
        </>
      )}
    </div>
  )
}
