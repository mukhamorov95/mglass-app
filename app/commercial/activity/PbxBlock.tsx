'use client'

import { useEffect, useState } from 'react'
import type { PbxReport } from '@/lib/pbxCallsFetch'
import { fmtTime, mskDay } from '@/lib/amoActivity'
import { Card, Num, fmtPhone, shortDay } from './ui'

// Журнал АТС: звонки, которых amo не видит. Пропущенный с нового номера на общую линию
// в amo не попадает вовсе — а это и есть потерянные клиенты.

export default function PbxBlock({ from, to, names }: { from: string; to: string; names: Map<number, string> }) {
  const [data, setData] = useState<PbxReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [key, setKey] = useState(`${from}:${to}`)

  if (key !== `${from}:${to}`) { setKey(`${from}:${to}`); setLoading(true) }

  useEffect(() => {
    let cancelled = false
    fetch(`/api/commercial/pbx-calls?from=${from}&to=${to}`)
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? `Ошибка ${res.status}`)
        if (!cancelled) { setData(json as PbxReport); setError(null) }
      })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setData(null) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  return (
    <Card title="Телефония (АТС onlinePBX)" hint="Все звонки АТС, включая те, что не попали в карточки amo. Перезвонили — исходящий на тот же номер или принятый входящий с него позже.">
      {loading && <p className="text-[13px] text-[#9a9a95]">Загружаю журнал АТС…</p>}
      {error && <p className="text-[13px] text-red-700">Журнал АТС недоступен: {error}</p>}
      {data && !loading && !data.configured && <p className="text-[13px] text-[#9a9a95]">АТС не подключена: нет ключа onlinePBX.</p>}
      {data && !loading && data.configured && (
        data.parsed === 0 ? (
          <p className="text-[13px] text-[#9a9a95]">
            За период звонков нет{data.rawCount > 0 && ` — АТС вернула ${data.rawCount} записей, но их формат не разобран. Поля: ${data.sampleKeys.join(', ')}`}.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Входящих', v: data.summary.inbound },
                { label: 'Принято', v: data.summary.inboundAnswered },
                { label: 'Пропущено звонков', v: data.summary.inboundMissed, sub: `от ${data.summary.missedClients} клиентов` },
                { label: 'Перезвонили за 2 ч', v: data.summary.missedCalledBack2h, sub: 'клиентов' },
                { label: 'Не перезвонили вовсе', v: data.summary.missedNeverCalledBack, sub: 'клиентов', warn: data.summary.missedNeverCalledBack > 0 },
              ].map(k => (
                <div key={k.label} className="bg-[#f5f5f3] rounded-lg px-3 py-2">
                  <div className="text-[11px] text-[#9a9a95]">{k.label}</div>
                  <div className={`text-[18px] font-semibold ${k.warn ? 'text-red-600' : 'text-[#111110]'}`}>{k.v}</div>
                  {'sub' in k && k.sub && <div className="text-[10px] text-[#9a9a95]">{k.sub}</div>}
                </div>
              ))}
            </div>
            <table className="w-full text-[13px] mb-3">
              <thead>
                <tr className="text-[11px] text-[#9a9a95] text-left border-b border-[#e4e4e0]">
                  <th className="py-1.5 pr-2 font-normal">Кто</th>
                  <th className="py-1.5 px-2 font-normal text-right">Принял входящих</th>
                  <th className="py-1.5 px-2 font-normal text-right">Исходящих (дозвон / всего)</th>
                  <th className="py-1.5 pl-2 font-normal text-right">Минут разговора</th>
                </tr>
              </thead>
              <tbody>
                {data.summary.byUser.map(u => (
                  <tr key={u.ext} className="border-b border-[#f0f0ec]">
                    <td className="py-1.5 pr-2 text-[#111110]">{(u.userId && names.get(u.userId)) ?? 'не определён'} <span className="text-[#9a9a95]">· вн. {u.ext}</span></td>
                    <td className="py-1.5 px-2 text-right"><Num v={u.inboundAnswered} /></td>
                    <td className="py-1.5 px-2 text-right"><Num v={u.outboundAnswered} /> <span className="text-[#9a9a95]">/ {u.outbound}</span></td>
                    <td className="py-1.5 pl-2 text-right"><Num v={Math.round(u.talkSec / 60)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[12px] text-[#6b6b66] mb-2">
              Разговоров, которых нет в карточках amo: <b>{data.summary.notInAmo}</b> — звонили с номера или на номер, не заведённый в amo.
            </p>
            {data.summary.missedNotCalledBackList.length > 0 && (
              <details>
                <summary className="cursor-pointer text-[12px] text-red-700">Клиенты, которым не перезвонили — {data.summary.missedNotCalledBackList.length}</summary>
                <ul className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 text-[12px] text-[#111110]">
                  {data.summary.missedNotCalledBackList.map(m => (
                    <li key={`${m.at}-${m.phone}`} className="py-0.5">
                      {fmtPhone(m.phone)} — последний звонок {shortDay(mskDay(m.at))} {fmtTime(m.at)}
                      {m.attempts > 1 && <span className="text-red-700"> · звонил {m.attempts} {m.attempts % 10 >= 2 && m.attempts % 10 <= 4 && (m.attempts < 10 || m.attempts > 20) ? 'раза' : 'раз'}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )
      )}
    </Card>
  )
}
