'use client'

// Б12: налоговый календарь. Сроки раскладываются типовым набором по режиму,
// суммы вбивает бухгалтер, оплата рождает операцию ДДС в фонде «Налоги».

import { useCallback, useEffect, useState } from 'react'

type Subfund = { id: number; fund_id: number; name: string }
type Tax = {
  id: number; kind: string; title: string; period: string | null
  due_date: string; amount: number | null; status: string; note: string | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(2, 4)}`
const REGIMES = [['usn', 'УСН'], ['patent', 'Патент'], ['osno', 'ОСНО (НДС)']] as const

export function TaxesTab({ unit, subfunds, today, onPaid }: {
  unit: 'ip' | 'ooo'; subfunds: Subfund[]; today: string; onPaid: () => void
}) {
  const [items, setItems] = useState<Tax[]>([])
  const [fundId, setFundId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPaid, setShowPaid] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [regime, setRegime] = useState<'usn' | 'patent' | 'osno'>('usn')

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/accounting/taxes?unit=${unit}`)
    if (r.ok) {
      const j = await r.json()
      setItems(j.items as Tax[])
      setFundId(j.tax_fund_id as number | null)
    }
    setLoading(false)
  }, [unit])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function generate() {
    const year = Number(today.slice(0, 4))
    setErr(null)
    const r = await fetch('/api/accounting/taxes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'generate', unit, year, regime }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j.error ?? 'Не получилось')
    else await load()
  }

  async function patch(id: number, body: Record<string, unknown>) {
    setBusy(id); setErr(null)
    const r = await fetch('/api/accounting/taxes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j.error ?? 'Не получилось')
    else { await load(); onPaid() }
    setBusy(null)
  }

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>

  const list = items.filter(i => showPaid ? i.status !== 'planned' : i.status === 'planned')
  const soon = items.filter(i => i.status === 'planned' && i.due_date <= addDays(today, 30))
  const overdue = items.filter(i => i.status === 'planned' && i.due_date < today)
  const taxSubs = subfunds.filter(s => s.fund_id === fundId)

  return (
    <div className="space-y-3">
      {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">{err}</div>}

      {overdue.length > 0 && (
        <div className="px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-800">
          Просрочено: {overdue.length} — на {RUB(overdue.reduce((s, i) => s + (i.amount ?? 0), 0))}
        </div>
      )}
      {overdue.length === 0 && soon.length > 0 && (
        <div className="px-3 py-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[13px] text-amber-900">
          Ближайшие 30 дней: {soon.length} платежа на {RUB(soon.reduce((s, i) => s + (i.amount ?? 0), 0))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-[#e4e4e0] p-3.5 flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-[#6b6b66]">Разложить сроки на {today.slice(0, 4)} год:</span>
        <select value={regime} onChange={e => setRegime(e.target.value as typeof regime)}
          className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
          {REGIMES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <button onClick={generate} className="px-3 py-1.5 rounded-lg border border-[#111110] text-[13px] font-medium">
          Заполнить календарь
        </button>
        <span className="text-[11px] text-[#9a9a95] w-full">
          Типовые сроки: авансы, годовой платёж, взносы и НДФЛ за сотрудников. Уже проставленные суммы не затираются.
          Праздничные переносы не учитываются — только выходные.
        </span>
      </div>

      <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px] w-fit">
        {([[false, 'Предстоящие'], [true, 'Закрытые']] as const).map(([k, label]) => (
          <button key={String(k)} onClick={() => setShowPaid(k)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium ${showPaid === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
        {list.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-[#9a9a95]">Пусто</p>}
        {list.map(t => {
          const late = t.status === 'planned' && t.due_date < today
          return (
            <div key={t.id} className="px-4 py-3 border-t border-[#f0f0ee] first:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] text-[#111110] font-medium">{t.title}</p>
                  <p className={`text-[12px] mt-0.5 ${late ? 'text-red-700 font-medium' : 'text-[#9a9a95]'}`}>
                    {t.kind} · {t.period ?? '—'} · до {DD(t.due_date)}{late ? ' · просрочено' : ''}
                    {t.status === 'paid' ? ' · оплачено' : t.status === 'cancelled' ? ' · отменено' : ''}
                  </p>
                </div>
                <span className="text-[14px] font-mono font-semibold text-[#111110] flex-shrink-0">
                  {t.amount ? RUB(t.amount) : '—'}
                </span>
              </div>

              {t.status === 'planned' && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <input defaultValue={t.amount ?? ''} placeholder="сумма" inputMode="decimal"
                    onBlur={e => {
                      const v = Number(e.target.value.replace(/\s/g, '').replace(',', '.'))
                      if (v !== (t.amount ?? 0)) patch(t.id, { action: 'amount', amount: v })
                    }}
                    className="w-28 border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] font-mono" />
                  <button onClick={() => patch(t.id, {
                    action: 'pay', fund_id: fundId,
                    subfund_id: taxSubs[0]?.id ?? 0, date: today,
                  })} disabled={busy === t.id || !t.amount || !fundId}
                    className="px-3 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                    {busy === t.id ? '…' : 'Оплачено'}
                  </button>
                  <button onClick={() => patch(t.id, { action: 'cancel' })} disabled={busy === t.id}
                    className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66] disabled:opacity-50">
                    не наш платёж
                  </button>
                  {!fundId && <span className="text-[12px] text-red-600">Нет фонда «Налоги» в этом юните</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10)
}
