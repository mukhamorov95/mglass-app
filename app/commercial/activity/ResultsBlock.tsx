'use client'

import { useEffect, useState } from 'react'
import type { AmoResultsReport } from '@/lib/amoResults'
import { Card, Num, fmtRub, fmtWait } from './ui'

// Результат рядом с активностью: без него самый занятой выглядит лучшим, а тот, кто
// тихо доводит сделки до оплаты, — бездельником.

const PERIODS = [30, 90] as const

export default function ResultsBlock() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(90)
  const [data, setData] = useState<AmoResultsReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/commercial/amo-results?days=${days}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setData(json as AmoResultsReport); setError(null) }
      })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const choose = (d: (typeof PERIODS)[number]) => { if (d !== days) { setDays(d); setLoading(true) } }

  return (
    <Card
      title="Результат"
      hint="Заявки → этапы → оплата. Этап засчитан тому, кто перевёл сделку вперёд; оплата — ответственному. Бюджет сделки в amo — не деньги в кассе."
      right={
        <div className="flex gap-1 bg-[#f5f5f3] rounded-lg p-1">
          {PERIODS.map(d => (
            <button key={d} onClick={() => choose(d)}
              className={`px-3 py-1 text-[12px] font-medium rounded-md ${days === d ? 'bg-[#111110] text-white' : 'text-[#6b6b66]'}`}>
              {d} дней
            </button>
          ))}
        </div>
      }
    >
      {loading && <p className="text-[13px] text-[#9a9a95]">Считаю по AmoCRM… за 90 дней это до минуты.</p>}
      {error && <p className="text-[13px] text-red-700">{error}</p>}
      {data && !loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[11px] text-[#9a9a95] text-left border-b border-[#e4e4e0]">
                <th className="py-2 pr-2 font-normal">Менеджер</th>
                <th className="py-2 px-2 font-normal text-right">Заявок получил</th>
                <th className="py-2 px-2 font-normal text-right" title="Заявки, пришедшие в будни с 9 до 19, по которым в карточке нет ни одного исходящего сообщения или звонка">Без контакта</th>
                <th className="py-2 px-2 font-normal text-right" title="Медиана от создания заявки до первого исходящего по карточке">Первый контакт</th>
                <th className="py-2 px-2 font-normal text-right">Замер</th>
                <th className="py-2 px-2 font-normal text-right">КП</th>
                <th className="py-2 px-2 font-normal text-right">Счёт</th>
                <th className="py-2 px-2 font-normal text-right" title="Сделка впервые перешла в этап оплаты за период">До оплаты</th>
                <th className="py-2 px-2 font-normal text-right">Бюджет</th>
                <th className="py-2 px-2 font-normal text-right" title="Сколько сделок дошло до оплаты на каждые 100 полученных заявок">На 100 заявок</th>
                <th className="py-2 px-2 font-normal text-right" title="Из полученных за период — закрыты «не реализовано»">Отказов</th>
                <th className="py-2 pl-2 font-normal text-right" title="Открытые задачи сейчас: просрочено (из них больше 30 дней)">Просрочено задач</th>
              </tr>
            </thead>
            <tbody>
              {data.managers.map(m => {
                const per100 = m.leadsReceived ? Math.round((m.paidDeals / m.leadsReceived) * 1000) / 10 : null
                return (
                  <tr key={m.userId} className="border-b border-[#f0f0ec]">
                    <td className="py-2 pr-2 font-medium text-[#111110]">{m.name}</td>
                    <td className="py-2 px-2 text-right"><Num v={m.leadsReceived} /></td>
                    <td className="py-2 px-2 text-right">
                      <span className={m.leadsNoContact ? 'text-amber-700' : 'text-[#9a9a95]'}>{m.leadsNoContact}</span>
                      <span className="text-[#9a9a95]"> из {m.leadsDaytime}</span>
                    </td>
                    <td className="py-2 px-2 text-right"><Num v={fmtWait(m.firstContactMedianMin)} /></td>
                    <td className="py-2 px-2 text-right"><Num v={m.advanced.measure} /></td>
                    <td className="py-2 px-2 text-right"><Num v={m.advanced.kp} /></td>
                    <td className="py-2 px-2 text-right"><Num v={m.advanced.invoice} /></td>
                    <td className="py-2 px-2 text-right font-medium"><Num v={m.paidDeals} /></td>
                    <td className="py-2 px-2 text-right"><Num v={m.paidBudget ? fmtRub(m.paidBudget) : 0} /></td>
                    <td className="py-2 px-2 text-right"><Num v={per100 === null ? '—' : String(per100).replace('.', ',')} /></td>
                    <td className="py-2 px-2 text-right"><Num v={m.lostOfReceived} muted /></td>
                    <td className="py-2 pl-2 text-right">
                      <span className={m.tasksOverdue > 20 ? 'text-red-600 font-medium' : m.tasksOverdue ? 'text-amber-700' : 'text-[#9a9a95]'}>{m.tasksOverdue}</span>
                      {m.tasksOverdue30 > 0 && <span className="text-[#9a9a95]"> ({m.tasksOverdue30} &gt;30 дн)</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-[#9a9a95] mt-2">
            Оплат у человека единицы в месяц — сравнивать людей надёжнее на 90 днях. «На 100 заявок» зависит и от того, какие заявки достаются: их распределяют вручную.
          </p>
        </div>
      )}
    </Card>
  )
}
