'use client'

// Б9: выписка. Загрузили файл из банка — получили список строк с подсказкой
// фонда (как разносили этого контрагента раньше или из одобренной заявки).
// Строка становится операцией ДДС только после «Провести».

import { useCallback, useEffect, useRef, useState } from 'react'

type Fund = { id: number; unit: string; fund_class: string; name: string }
type Subfund = { id: number; fund_id: number; name: string }
type Suggest = { fund_id: number; subfund_id: number | null; account: string | null; from: 'история' | 'заявка' } | null
type Row = {
  id: number; op_date: string; amount: number; direction: 'in' | 'out'
  counterparty: string | null; purpose: string | null; doc_no: string | null
  status: string; suggest: Suggest; request: { id: number; status: string } | null
  invoice: { id: number; no: string; payer: string | null; amount: number; orders: number[] } | null
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function BankTab({ unit, funds, subfunds, onPosted }: {
  unit: 'ip' | 'ooo'; funds: Fund[]; subfunds: Subfund[]; onPosted: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [status, setStatus] = useState<'new' | 'posted' | 'skipped'>('new')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<number, { fund: number; sub: number }>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch(`/api/accounting/bank?unit=${unit}&status=${status}`)
    if (r.ok) setRows((await r.json()).items as Row[])
    setLoading(false)
  }, [unit, status])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [load])

  async function upload(file: File) {
    setErr(null); setMsg('Читаю выписку…')
    const body = new FormData()
    body.append('file', file)
    body.append('unit', unit)
    const r = await fetch('/api/accounting/bank', { method: 'POST', body })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { setErr(j.error ?? 'Не разобралось'); setMsg(null); return }
    setMsg(`Формат ${j.format === '1c' ? '1С-обмен' : 'CSV'}: строк ${j.parsed}, новых ${j.added}, уже было ${j.duplicates}`)
    await load()
  }

  async function act(id: number, body: Record<string, unknown>) {
    setBusy(id); setErr(null)
    const r = await fetch('/api/accounting/bank', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) setErr(j.error ?? 'Не получилось')
    else { await load(); onPosted() }
    setBusy(null)
  }

  const pick = (r: Row) => draft[r.id] ?? {
    fund: r.suggest?.fund_id ?? 0,
    sub: r.suggest?.subfund_id ?? 0,
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
        <p className="text-[13px] text-[#111110] font-medium">Загрузить выписку · {unit === 'ip' ? 'ИП' : 'ООО'}</p>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          Файл из банка: 1С-обмен (.txt) или выгрузка CSV. Повторная загрузка того же периода дубли не создаст.
        </p>
        <input ref={fileRef} type="file" accept=".txt,.csv,text/plain,text/csv" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()}
          className="mt-3 px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold">
          Выбрать файл
        </button>
        {msg && <p className="text-[12px] text-[#6b6b66] mt-2">{msg}</p>}
        {err && <p className="text-[12px] text-red-600 mt-2">{err}</p>}
      </div>

      <div className="flex bg-[#f0f0ec] rounded-[10px] p-[3px] w-fit">
        {([['new', 'Новые'], ['posted', 'Проведённые'], ['skipped', 'Пропущенные']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setStatus(k)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium ${status === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>}
      {!loading && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-8 text-center text-[13px] text-[#9a9a95]">
          {status === 'new' ? 'Нечего разносить — загрузите выписку' : 'Пусто'}
        </div>
      )}

      {rows.map(r => {
        const d = pick(r)
        const unitFunds = funds.filter(f => f.unit === unit && (r.direction === 'in' ? f.fund_class === 'income' : f.fund_class !== 'income'))
        return (
          <div key={r.id} className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] text-[#111110] font-medium truncate">{r.counterparty ?? 'Без контрагента'}</p>
                <p className="text-[12px] text-[#9a9a95] mt-0.5">
                  {DD(r.op_date)}{r.doc_no ? ` · док. ${r.doc_no}` : ''}
                  {r.request ? ' · есть заявка' : ''}
                  {r.invoice ? ` · счёт ${r.invoice.no}${r.invoice.payer ? `, ${r.invoice.payer}` : ''}${r.invoice.orders.length > 1 ? ` (заказов ${r.invoice.orders.length})` : ''}` : ''}
                  {r.suggest ? ` · фонд из: ${r.suggest.from}` : ''}
                </p>
                {r.purpose && <p className="text-[12px] text-[#6b6b66] mt-1 line-clamp-2">{r.purpose}</p>}
                {r.direction === 'in' && !r.invoice && (
                  <p className="text-[12px] text-[#9a9a95] mt-1">счёт не нашёлся — проведём как обычный приход</p>
                )}
              </div>
              <span className={`text-[15px] font-mono font-semibold flex-shrink-0 ${r.direction === 'in' ? 'text-emerald-700' : 'text-[#111110]'}`}>
                {r.direction === 'in' ? '+' : '−'}{RUB(r.amount)}
              </span>
            </div>

            {status === 'new' && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select value={d.fund} onChange={e => setDraft(p => ({ ...p, [r.id]: { ...pick(r), fund: Number(e.target.value), sub: 0 } }))}
                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
                  <option value={0}>фонд…</option>
                  {unitFunds.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
                <select value={d.sub} onChange={e => setDraft(p => ({ ...p, [r.id]: { ...pick(r), sub: Number(e.target.value) } }))}
                  className="border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white">
                  <option value={0}>подфонд…</option>
                  {subfunds.filter(s => s.fund_id === d.fund).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button onClick={() => act(r.id, {
                  action: 'post', fund_id: d.fund, subfund_id: d.sub,
                  request_id: r.request?.id, invoice_id: r.invoice?.id,
                })}
                  disabled={busy === r.id || !d.fund}
                  className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                  {busy === r.id ? '…'
                    : r.request ? 'Провести и закрыть заявку'
                    : r.invoice ? 'Провести и закрыть счёт'
                    : 'Провести'}
                </button>
                <button onClick={() => act(r.id, { action: 'skip' })} disabled={busy === r.id}
                  className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66] disabled:opacity-50">
                  пропустить
                </button>
              </div>
            )}
            {status === 'skipped' && (
              <button onClick={() => act(r.id, { action: 'unskip' })} disabled={busy === r.id}
                className="mt-3 px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] disabled:opacity-50">
                вернуть в работу
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
