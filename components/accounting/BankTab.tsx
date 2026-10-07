'use client'

// Б9: выписка. Загрузили файл из банка — получили список строк с подсказкой
// фонда (как разносили этого контрагента раньше или из одобренной заявки).
// Строка становится операцией ДДС только после «Провести».

import { useEffect, useRef, useState } from 'react'
import { loadJson, sendOrToast, toast } from '@/lib/toast'
import { rowEffect, searchInvoices, type OpenInvoice } from '@/lib/accounting/bankMatch'

type Fund = { id: number; unit: string; fund_class: string; name: string }
type Subfund = { id: number; fund_id: number; name: string }
type Suggest = { fund_id: number; subfund_id: number | null; account: string | null; from: 'история' | 'заявка' } | null
type RowInvoice = { id: number; no: string; payer: string | null; amount: number; orders: number[]; remainder?: number; paid?: number }
type Row = {
  id: number; op_date: string; amount: number; direction: 'in' | 'out'
  counterparty: string | null; purpose: string | null; doc_no: string | null
  status: string; suggest: Suggest; request: { id: number; status: string } | null
  invoice: RowInvoice | null
}
type BankList = { items: Row[]; invoices?: OpenInvoice[]; invoicesError?: string | null }
type PostAnswer = {
  invoice: { no: string; partial: boolean; rest: number; over: number; replaced: number } | null
  warnings?: string[]
}

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const DD = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`

export function BankTab({ unit, funds, subfunds, onPosted }: {
  unit: 'ip' | 'ooo'; funds: Fund[]; subfunds: Subfund[]; onPosted: () => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [invoices, setInvoices] = useState<OpenInvoice[]>([])
  const [invoicesError, setInvoicesError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [status, setStatus] = useState<'new' | 'posted' | 'skipped'>('new')
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<number, { fund: number; sub: number }>>({})
  // Ручной выбор счёта: undefined — как подобрал сервер, null — «без счёта»
  const [chosen, setChosen] = useState<Record<number, OpenInvoice | null>>({})
  const [picker, setPicker] = useState<{ row: number; q: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    loadJson<BankList>(`/api/accounting/bank?unit=${unit}&status=${status}`).then(res => {
      if (!alive) return
      if (res.error !== null) setLoadError(res.error)
      else {
        setRows(res.data.items)
        setInvoices(res.data.invoices ?? [])
        setInvoicesError(res.data.invoicesError ?? null)
        setLoadError(null)
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [unit, status, tick])

  const reload = () => { setLoading(true); setTick(t => t + 1) }
  const switchStatus = (k: typeof status) => { if (k !== status) { setLoading(true); setStatus(k) } }

  async function upload(file: File) {
    setErr(null); setMsg('Читаю выписку…')
    const body = new FormData()
    body.append('file', file)
    body.append('unit', unit)
    const r = await fetch('/api/accounting/bank', { method: 'POST', body }).catch(() => null)
    const j = r ? await r.json().catch(() => ({})) : {}
    if (!r || !r.ok) { setErr(r ? (j.error ?? `Не разобралось (${r.status})`) : 'Сервер не ответил — проверьте связь'); setMsg(null); return }
    const fmt = j.format === '1c' ? '1С-обмен' : 'CSV'
    if (j.empty) {
      const rec = j.reconcile
      setMsg(`${fmt}: движений за день нет${rec?.closing != null ? ` · остаток на счёте ${RUB(rec.closing)}` : ''}`)
    } else {
      let m = `${fmt}: строк ${j.parsed}, новых ${j.added}, уже было ${j.duplicates}`
      const rec = j.reconcile
      if (rec) {
        m += rec.ok
          ? ` · сошлось с итогами банка (приход ${RUB(rec.bankIn)}, расход ${RUB(rec.bankOut)})`
          : ` · ⚠️ расходится с банком: у нас приход ${RUB(rec.parsedIn)}/расход ${RUB(rec.parsedOut)}, банк ${RUB(rec.bankIn)}/${RUB(rec.bankOut)}`
      }
      setMsg(m)
    }
    reload()
  }

  async function act(id: number, body: Record<string, unknown>, failTitle: string) {
    setBusy(id)
    const r = await sendOrToast(failTitle, '/api/accounting/bank', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    setBusy(null)
    if (!r) return
    const j = await r.json().catch(() => ({})) as PostAnswer
    if (body.action === 'post') {
      const inv = j.invoice
      toast.success(inv
        ? inv.partial ? `Проведено: частичная оплата счёта № ${inv.no}, останется ${RUB(inv.rest)}` : `Проведено, счёт № ${inv.no} оплачен`
        : 'Проведено', {
        detail: inv?.replaced ? 'Ручная отметка «Оплачен» по счёту заменена платежом из выписки' : undefined,
      })
      for (const w of j.warnings ?? []) toast.info(w)
      setChosen(p => { const n = { ...p }; delete n[id]; return n })
    }
    reload(); onPosted()
  }

  const invoiceOf = (r: Row): (RowInvoice & { manual: boolean }) | null => {
    if (r.id in chosen) { const c = chosen[r.id]; return c ? { ...c, manual: true } : null }
    return r.invoice ? { ...r.invoice, manual: false } : null
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
          <button key={k} onClick={() => switchStatus(k)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium ${status === k ? 'bg-white shadow-sm text-[#111110]' : 'text-[#6b6b66]'}`}>
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[13px] flex items-center justify-between gap-3">
          <span>Выписка не загрузилась: {loadError}</span>
          <button onClick={reload} className="underline flex-shrink-0">повторить</button>
        </div>
      )}
      {status === 'new' && invoicesError && (
        <p className="px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-[13px]">
          Счета не загрузились ({invoicesError}) — подбор и выбор счёта сейчас недоступны, приход можно провести без счёта.
        </p>
      )}

      {loading && <p className="text-[13px] text-[#9a9a95] py-6 text-center">Загрузка…</p>}
      {!loading && !loadError && rows.length === 0 && (
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-8 text-center text-[13px] text-[#9a9a95]">
          {status === 'new' ? 'Нечего разносить — загрузите выписку' : 'Пусто'}
        </div>
      )}

      {rows.map(r => {
        const d = pick(r)
        const unitFunds = funds.filter(f => f.unit === unit && (r.direction === 'in' ? f.fund_class === 'income' : f.fund_class !== 'income'))
        const inv = r.direction === 'in' ? invoiceOf(r) : null
        const eff = inv && inv.remainder != null ? rowEffect(inv.remainder, r.amount) : null
        const open = picker?.row === r.id
        return (
          <div key={r.id} className="bg-white rounded-xl border border-[#e4e4e0] p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[14px] text-[#111110] font-medium truncate">{r.counterparty ?? 'Без контрагента'}</p>
                <p className="text-[12px] text-[#9a9a95] mt-0.5">
                  {DD(r.op_date)}{r.doc_no ? ` · док. ${r.doc_no}` : ''}
                  {r.request ? ' · есть заявка' : ''}
                  {r.suggest ? ` · фонд из: ${r.suggest.from}` : ''}
                </p>
                {r.purpose && <p className="text-[12px] text-[#6b6b66] mt-1 line-clamp-2">{r.purpose}</p>}
              </div>
              <span className={`text-[15px] font-mono font-semibold flex-shrink-0 ${r.direction === 'in' ? 'text-emerald-700' : 'text-[#111110]'}`}>
                {r.direction === 'in' ? '+' : '−'}{RUB(r.amount)}
              </span>
            </div>

            {r.direction === 'in' && (
              <div className="mt-2 text-[12px] flex flex-wrap items-center gap-x-2 gap-y-1">
                {inv ? (
                  <>
                    <span className="text-[#111110]">
                      Счёт № {inv.no}{inv.payer ? `, ${inv.payer}` : ''}{inv.orders.length > 1 ? ` (заказов ${inv.orders.length})` : ''}
                      {inv.remainder != null && inv.remainder < inv.amount - 0.5 ? ` · остаток ${RUB(inv.remainder)} из ${RUB(inv.amount)}` : ` · ${RUB(inv.amount)}`}
                    </span>
                    {status === 'new' && <span className="text-[#9a9a95]">{inv.manual ? 'выбран вручную' : 'подобран по ИНН/номеру/сумме'}</span>}
                    {status === 'new' && eff && (
                      eff.partial
                        ? <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">частичная оплата — останется {RUB(eff.rest)}</span>
                        : eff.over > 0
                          ? <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">переплата {RUB(eff.over)}</span>
                          : <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">закроет счёт</span>
                    )}
                  </>
                ) : status === 'new' ? (
                  <span className="text-[#9a9a95]">счёт не подобран — проведём как обычный приход</span>
                ) : null}
                {status === 'new' && !invoicesError && (
                  <>
                    <button onClick={() => setPicker(open ? null : { row: r.id, q: '' })} className="text-[#111110] underline">
                      {inv ? 'другой счёт' : 'выбрать счёт'}
                    </button>
                    {inv && (
                      <button onClick={() => { setChosen(p => ({ ...p, [r.id]: null })); setPicker(null) }} className="text-[#6b6b66] underline">
                        без счёта
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {open && (
              <div className="mt-2 rounded-lg border border-[#e4e4e0] bg-[#f5f5f3] p-2">
                <input autoFocus value={picker.q} onChange={e => setPicker({ row: r.id, q: e.target.value })}
                  placeholder="номер счёта, плательщик, ИНН или сумма"
                  className="w-full border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] bg-white" />
                <div className="mt-1.5 space-y-1 max-h-64 overflow-y-auto">
                  {searchInvoices(invoices, picker.q, r.amount).map(i => (
                    <button key={i.id} onClick={() => { setChosen(p => ({ ...p, [r.id]: i })); setPicker(null) }}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white border border-[#e4e4e0] hover:border-[#111110] text-[12px]">
                      <span className="font-medium text-[#111110]">№ {i.no}</span>
                      <span className="text-[#6b6b66]"> · {i.payer ?? 'плательщик не указан'}</span>
                      <span className="float-right font-mono text-[#111110]">
                        {RUB(i.remainder)}{i.paid > 0 ? <span className="text-[#9a9a95]"> из {RUB(i.amount)}</span> : null}
                      </span>
                    </button>
                  ))}
                  {searchInvoices(invoices, picker.q, r.amount).length === 0 && (
                    <p className="text-[12px] text-[#9a9a95] px-1 py-2">Неоплаченных счетов по запросу нет</p>
                  )}
                </div>
              </div>
            )}

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
                  request_id: r.request?.id, invoice_id: inv?.id,
                }, 'Строка не проведена')}
                  disabled={busy === r.id || !d.fund}
                  className="px-4 py-1.5 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                  {busy === r.id ? '…'
                    : r.request ? 'Провести и закрыть заявку'
                    : inv ? (eff?.partial ? 'Провести как частичную оплату' : 'Провести и закрыть счёт')
                    : 'Провести'}
                </button>
                <button onClick={() => act(r.id, { action: 'skip' }, 'Строка не пропущена')} disabled={busy === r.id}
                  className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[13px] text-[#6b6b66] disabled:opacity-50">
                  пропустить
                </button>
              </div>
            )}
            {status === 'skipped' && (
              <button onClick={() => act(r.id, { action: 'unskip' }, 'Строка не возвращена')} disabled={busy === r.id}
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
