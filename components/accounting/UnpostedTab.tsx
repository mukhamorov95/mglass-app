'use client'

// Б5: оплаты из ядра payments, которых ещё нет в ОДДС. Проводятся одной
// кнопкой — фонд подставляется по прошлой такой же проводке. «Не наши деньги»
// прячутся в пропущенные (не удаляются, возвращаемы).

import { useCallback, useEffect, useMemo, useState } from 'react'

type Fund = { id: number; unit: string; fund_class: string; name: string }
type Subfund = { id: number; fund_id: number; name: string }
type Suggest = { unit: string; fund_id: number; subfund_id: number | null; account: string | null } | null
type Item = {
  id: number; paid_at: string; amount: number; kind_label: string; method: string
  note: string | null
  doc: { kind: 'b2b' | 'b2c' | 'sale'; number: string | null; client: string | null }
  skipped: boolean; skip_reason: string | null; suggest: Suggest
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const DOC_LABEL: Record<string, string> = { b2b: 'B2B', b2c: 'Розница', sale: 'Продажа' }

export function UnpostedTab({ unit, funds, subfunds, month, onPosted }: {
  unit: 'ip' | 'ooo'; funds: Fund[]; subfunds: Subfund[]; month: string; onPosted: () => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [showSkipped, setShowSkipped] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<number, { fund: number; sub: number; unit: 'ip' | 'ooo' }>>({})

  const incomeFunds = useMemo(
    () => funds.filter(f => f.fund_class === 'income'),
    [funds],
  )

  const load = useCallback(async () => {
    if (!month) return
    const [y, m] = month.split('-').map(Number)
    const from = `${month}-01`
    const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
    setLoading(true)
    try {
      const r = await fetch(`/api/accounting/unposted?from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Не загрузилось')
      setItems(j.items as Item[])
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не загрузилось')
    }
    setLoading(false)
  }, [month])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  const pick = (it: Item) => {
    const d = draft[it.id]
    if (d) return d
    const s = it.suggest
    const u = (s?.unit === 'ooo' ? 'ooo' : s?.unit === 'ip' ? 'ip' : unit) as 'ip' | 'ooo'
    const fundOk = s && funds.some(f => f.id === s.fund_id && f.unit === u)
    return {
      unit: u,
      fund: fundOk ? s!.fund_id : (incomeFunds.find(f => f.unit === u)?.id ?? 0),
      sub: fundOk ? (s!.subfund_id ?? 0) : 0,
    }
  }
  const setPick = (id: number, patch: Partial<{ fund: number; sub: number; unit: 'ip' | 'ooo' }>, base: Item) =>
    setDraft(p => ({ ...p, [id]: { ...pick(base), ...patch } }))

  async function send(id: number, body: Record<string, unknown>) {
    setBusy(id); setErr(null)
    try {
      const r = await fetch('/api/accounting/unposted', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_id: id, ...body }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Не получилось')
      await load()
      onPosted()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не получилось')
    }
    setBusy(null)
  }

  const visible = items.filter(i => i.skipped === showSkipped)

  if (loading) return <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>

  return (
    <div className="space-y-3">
      {err && <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px]">{err}</div>}

      <div className="flex items-center justify-between">
        <p className="text-[13px] text-[#6b6b66]">
          Оплаты, которых ещё нет в ОДДС. Проводите — операция появится в фонде и не потребует ручного ввода.
        </p>
        <button onClick={() => setShowSkipped(s => !s)}
          className="text-[12px] text-[#9a9a95] underline flex-shrink-0 ml-3">
          {showSkipped ? '← к непроведённым' : 'пропущенные'}
        </button>
      </div>

      {visible.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-8 text-center text-[13px] text-[#9a9a95]">
          {showSkipped ? 'Пропущенных нет' : 'Всё проведено — новых оплат за месяц нет'}
        </div>
      )}

      {visible.map(it => {
        const d = pick(it)
        const unitFunds = incomeFunds.filter(f => f.unit === d.unit)
        return (
          <div key={it.id} className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] text-[#111110] font-medium truncate">
                  {it.doc.client ?? 'Без клиента'}
                </p>
                <p className="text-[12px] text-[#9a9a95] mt-0.5">
                  {DD(it.paid_at)} · {DOC_LABEL[it.doc.kind]}{it.doc.number ? ` ${it.doc.number}` : ''} · {it.method} · {it.kind_label}
                </p>
                {it.skip_reason && <p className="text-[12px] text-[#9a9a95] mt-1">Пропущено: {it.skip_reason}</p>}
              </div>
              <span className="text-[15px] font-mono font-semibold text-emerald-700 flex-shrink-0">+{RUB(it.amount)}</span>
            </div>

            {showSkipped ? (
              <button onClick={() => send(it.id, { action: 'unskip' })} disabled={busy === it.id}
                className="mt-3 px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] disabled:opacity-50">
                вернуть в работу
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <div className="flex bg-[#f0f0ec] rounded-lg p-[3px]">
                  {(['ip', 'ooo'] as const).map(u => (
                    <button key={u} onClick={() => setPick(it.id, { unit: u, fund: incomeFunds.find(f => f.unit === u)?.id ?? 0, sub: 0 }, it)}
                      className={`px-2.5 py-1 rounded-md text-[12px] font-medium ${d.unit === u ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
                      {u === 'ip' ? 'ИП' : 'ООО'}
                    </button>
                  ))}
                </div>
                <select value={d.fund} onChange={e => setPick(it.id, { fund: Number(e.target.value), sub: 0 }, it)}
                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
                  <option value={0}>фонд…</option>
                  {unitFunds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select value={d.sub} onChange={e => setPick(it.id, { sub: Number(e.target.value) }, it)}
                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
                  <option value={0}>подфонд…</option>
                  {subfunds.filter(s => s.fund_id === d.fund).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => send(it.id, {
                  action: 'post', unit: d.unit, fund_id: d.fund, subfund_id: d.sub,
                  counterparty: it.doc.client, comment: it.doc.number ? `Заказ ${it.doc.number}` : null,
                })} disabled={busy === it.id || !d.fund}
                  className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                  {busy === it.id ? '…' : 'Провести'}
                </button>
                <button onClick={() => {
                  const reason = prompt('Почему не проводим?')?.trim()
                  if (reason === undefined) return
                  send(it.id, { action: 'skip', reason })
                }} disabled={busy === it.id}
                  className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66] disabled:opacity-50">
                  пропустить
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
