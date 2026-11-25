'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { loadJson, toast } from '@/lib/toast'
import { INVOICE_HINT, type InvoiceState, type UpdShort } from '@/lib/partner/documents'
import type { PaymentView } from '@/lib/partner/orderMoney'
import { DOC_FILTERS, inDocFilter, isUnpaid, payBadge, shipBadge, TONE_CLASS, type DocFilter } from '@/lib/partner/docStatus'
import { unpaidOf } from '@/lib/partner/paymentLabel'
import { matchesOrder } from '@/lib/partner/orderSearch'
import DownloadMenu, { type DlItem } from './DownloadMenu'

// Документы кабинета (дизайн .pcab): по каждому заказу одной строкой КП · счёт · УПД.
// Счёт — если он открыт этому партнёру; УПД — только выданный бухгалтерией.

type Order = {
  id: number; number: string; clientOrderNumber?: string | null; created_at: string; amount: number; summary: string; positions: number; lane: string
  invoice: InvoiceState; upd: UpdShort | null
  payment?: PaymentView | null; shipPartial?: { shipped: number; total: number } | null
}
type Resp = { linked: boolean; orders: Order[]; updError?: string | null }
type Inv = {
  id: number; no: string; issuedAt: string; amount: number; paid: number; remainder: number; status: 'paid' | 'partial' | 'unpaid'
  orders: { id: number; no: string }[]; paymentDoc: { name: string; at: string | null } | null
}
type InvResp = { canCombine: boolean; invoices: Inv[] }

const fmtMoney = (n: number) => n > 0 ? Math.round(n).toLocaleString('ru-RU') + ' ₽' : '—'
const monthOf = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', month: 'long', year: 'numeric' })
const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })

export default function PartnerDocumentsPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [flt, setFlt] = useState<DocFilter>('all')
  const router = useRouter()
  const [inv, setInv] = useState<InvResp | null>(null)
  const [invErr, setInvErr] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const [combining, setCombining] = useState(false)

  useEffect(() => {
    let alive = true
    loadJson<Resp>('/api/partner/orders').then(r => {
      if (!alive) return
      if (r.error !== null) setError(r.error)
      else setData(r.data)
      setLoading(false)
    })
    loadJson<InvResp>('/api/partner/invoices').then(r => {
      if (!alive) return
      if (r.error !== null) setInvErr(r.error); else setInv(r.data)
    })
    return () => { alive = false }
  }, [])

  const all = useMemo(() => data?.orders ?? [], [data])
  // Поиск по номеру, описанию, сумме и номеру УПД; список — по месяцам (24.11: 130 строк сплошняком).
  const orders = useMemo(() => all.filter(o => inDocFilter(o, flt) && matchesOrder({ number: o.number, clientOrderNumber: o.clientOrderNumber, amount: o.amount, summary: o.summary, extra: [o.upd ? String(o.upd.number) : null] }, q)), [all, q, flt])
  // Неоплаченные заказы — первой группой над месяцами (владелец 25.11): их и надо оплатить.
  const months = useMemo(() => {
    const out: { m: string; list: Order[] }[] = []
    const unpaid = orders.filter(isUnpaid)
    if (unpaid.length > 0 && flt !== 'paid') out.push({ m: 'Ждут оплаты', list: unpaid })
    for (const o of orders) {
      if (isUnpaid(o)) continue
      const m = monthOf(o.created_at)
      if (out.at(-1)?.m === m) out.at(-1)!.list.push(o); else out.push({ m, list: [o] })
    }
    return out
  }, [orders, flt])
  const fCount = useMemo(() => Object.fromEntries(DOC_FILTERS.map(f => [f.key, all.filter(o => inDocFilter(o, f.key)).length])) as Record<DocFilter, number>, [all])
  const unpaidSum = useMemo(() => all.filter(isUnpaid).reduce((s, o) => s + unpaidOf(o.payment), 0), [all])
  const hasStatus = all.some(o => o.lane === 'in_work' || o.lane === 'shipped')
  // Заказ в живом объединённом счёте: галочки у него нет, есть ссылка на счёт.
  const inInvoice = useMemo(() => {
    const m = new Map<number, Inv>()
    for (const i of inv?.invoices ?? []) for (const o of i.orders) m.set(o.id, i)
    return m
  }, [inv])
  const canCombine = !!inv?.canCombine
  const selectable = (o: Order) => canCombine && o.invoice === 'open' && o.payment?.status === 'awaiting' && !inInvoice.has(o.id)
  const selSum = all.filter(o => sel.has(o.id)).reduce((s, o) => s + o.amount, 0)
  const toggle = (id: number) => setSel(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function combine() {
    setCombining(true)
    try {
      const r = await fetch('/api/partner/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderIds: [...sel] }) })
      const d = await r.json().catch(() => ({})) as { id?: number; error?: string; replaced?: string[] }
      if (!r.ok || !d.id) { toast.error('Счёт не создан', { detail: d.error ?? `Ошибка ${r.status}` }); return }
      router.push(`/partner/invoices/${d.id}`)
    } catch { toast.error('Счёт не создан', { detail: 'Сеть недоступна — попробуйте ещё раз' }) }
    finally { setCombining(false) }
  }
  const [uploading, setUploading] = useState<number | null>(null)
  async function attachPayment(invId: number, file: File | undefined) {
    if (!file) return
    setUploading(invId)
    try {
      const fd = new FormData(); fd.append('file', file)
      const r = await fetch(`/api/partner/invoices/${invId}/payment-doc`, { method: 'POST', body: fd })
      const d = await r.json().catch(() => ({})) as { name?: string; at?: string; error?: string }
      if (!r.ok || !d.at) { toast.error('Платёжка не приложена', { detail: d.error ?? `Ошибка ${r.status}` }); return }
      setInv(prev => prev && { ...prev, invoices: prev.invoices.map(i => i.id === invId ? { ...i, paymentDoc: { name: d.name ?? file.name, at: d.at ?? null } } : i) })
      toast.success('Платёжка приложена к счёту', { detail: 'Менеджер её видит. Заказы станут «Оплачен», когда деньги поступят на счёт.' })
    } catch { toast.error('Платёжка не приложена', { detail: 'Сеть недоступна — попробуйте ещё раз' }) }
    finally { setUploading(null) }
  }
  const updUnknown = !!data?.updError
  const managerSendsInvoice = all.some(o => o.invoice === 'manager')
  // Что скачивается из строки сразу файлом: КП всегда, счёт — свой или общий, УПД — выданный.
  const dlItems = (o: Order): DlItem[] => {
    const out: DlItem[] = [{ label: 'КП', href: `/partner/order/${o.id}/kp` }]
    const common = inInvoice.get(o.id)
    if (common) out.push({ label: 'Счёт', href: `/partner/invoices/${common.id}` })
    else if (o.invoice === 'open') out.push({ label: 'Счёт', href: `/partner/order/${o.id}/invoice` })
    if (o.upd) out.push({ label: 'УПД', href: `/partner/order/${o.id}/upd` })
    return out
  }
  const updHint = (o: Order) => updUnknown ? 'УПД — не проверено' : o.lane === 'shipped' ? 'УПД — у менеджера' : 'УПД — после отгрузки'

  return (
    <>
      <div className="top">
        <div>
          <h1>Документы</h1>
          <div className="cap">КП, счета и УПД по вашим заказам</div>
        </div>
        <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
      </div>

      <div className="wrap">
        {managerSendsInvoice && (
          <div className="info" style={{ marginBottom: 14 }}>
            <span>ℹ️</span>
            <span>По заказам с пометкой «счёт пришлёт менеджер» <b>счёт-спецификацию</b> для оплаты выставляет ваш менеджер M-Glass.</span>
          </div>
        )}
        {updUnknown && (
          <div className="recalc" style={{ marginBottom: 14 }}>Реестр УПД сейчас не прочитался — у строк ниже статус УПД неизвестен. Обновите страницу через минуту.</div>
        )}

        {loading && <div className="note"><div className="s">Загрузка…</div></div>}
        {!loading && error && <div className="note"><div className="t">Документы не загрузились</div><div className="s">{error}</div></div>}
        {!loading && data && !data.linked && <div className="note"><div className="s">Аккаунт ещё не привязан к вашей компании.</div></div>}
        {!loading && data?.linked && all.length === 0 && (
          <div className="note"><div className="s">Пока нет документов. Создайте просчёт в разделе «Калькулятор».</div></div>
        )}
        {!loading && data?.linked && all.length > 0 && (
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: наш № или ваш № заказа, сумма, № УПД, материал" aria-label="Поиск документов"
            style={{ width: '100%', marginBottom: 14, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: '10px 12px', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit', outline: 'none' }} />
        )}
        {invErr && <div className="recalc" style={{ marginBottom: 14 }}>Объединённые счета не загрузились: {invErr}</div>}
        {!loading && (inv?.invoices.length ?? 0) > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div className="lane-lbl">Объединённые счета <span className="n">{inv!.invoices.length}</span></div>
            <div className="card">
              {inv!.invoices.map((i, k) => (
                <div className={`doc${k === 0 ? ' first' : ''}`} key={i.id}>
                  <div className="fi">₽</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="fn">Счёт № {i.no} · {fmtMoney(i.amount)}</div>
                    <div className="fm">от {fmtDate(i.issuedAt)} · заказы {i.orders.map(o => o.no).join(', ')}</div>
                    <div className="pills">
                      <span className={`pill ${i.status === 'paid' ? 'p-ready' : i.status === 'partial' ? 'p-sub' : 'p-bad'}`}>
                        {i.status === 'paid' ? 'Оплачен' : i.status === 'partial' ? `Оплачено ${fmtMoney(i.paid)} из ${fmtMoney(i.amount)}` : 'Не оплачен'}
                      </span>
                      {i.paymentDoc && i.status !== 'paid' && (
                        <span className="pill p-sub">Платёжка приложена{i.paymentDoc.at ? ` ${fmtDate(i.paymentDoc.at)}` : ''} — ждём поступления</span>
                      )}
                    </div>
                  </div>
                  <div className="dset">
                    <DownloadMenu items={[{ label: 'Счёт', href: `/partner/invoices/${i.id}` }]} />
                    <Link className="dl" href={`/partner/invoices/${i.id}`}>Открыть счёт</Link>
                    {i.paymentDoc && <a className="dl" href={`/api/partner/invoices/${i.id}/payment-doc`} target="_blank" rel="noreferrer">Платёжка</a>}
                    {i.status !== 'paid' && (
                      <label className="dl" style={{ cursor: uploading === i.id ? 'wait' : 'pointer' }}>
                        {uploading === i.id ? 'Загружаю…' : i.paymentDoc ? 'Заменить платёжку' : '📎 Приложить платёжку'}
                        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" hidden disabled={uploading !== null}
                          onChange={e => { void attachPayment(i.id, e.target.files?.[0]); e.target.value = '' }} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!loading && canCombine && all.some(selectable) && (
          <div className="info" style={{ marginBottom: 14 }}>
            <span>☑️</span>
            <span>Отметьте неоплаченные заказы галочкой — соберём их в <b>один счёт</b> и вы оплатите одной суммой. Оплата разойдётся по заказам сама, УПД — по каждому заказу.</span>
          </div>
        )}
        {sel.size > 0 && (
          <div className="card" style={{ position: 'sticky', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', zIndex: 5, marginBottom: 14, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>Выбрано {sel.size} · {fmtMoney(selSum)}</span>
            <button className="ghost" onClick={() => setSel(new Set())} style={{ marginLeft: 'auto' }}>Снять</button>
            <button className="primary" disabled={sel.size < 2 || combining} onClick={combine} title={sel.size < 2 ? 'Нужно хотя бы два заказа' : undefined}>
              {combining ? 'Создаю счёт…' : sel.size < 2 ? 'Отметьте ещё заказ' : 'Объединить в один счёт'}
            </button>
          </div>
        )}
        {!loading && data?.linked && hasStatus && (
          <div className="fchips" role="tablist" aria-label="Фильтр документов">
            {DOC_FILTERS.map(f => (
              <button key={f.key} role="tab" aria-selected={flt === f.key} className={flt === f.key ? 'on' : ''} onClick={() => setFlt(f.key)}>
                {f.label} <span className="n">{fCount[f.key]}{f.key === 'unpaid' && unpaidSum > 0 ? ` · ${fmtMoney(unpaidSum)}` : ''}</span>
              </button>
            ))}
          </div>
        )}
        {!loading && data?.linked && all.length > 0 && orders.length === 0 && (
          <div className="note"><div className="s">{q ? `По запросу «${q}» ничего нет.` : 'В этом фильтре заказов нет.'}</div></div>
        )}
        {!loading && data?.linked && months.map(({ m, list }) => (
          <div key={m} style={{ marginBottom: 14 }}>
          <div className="lane-lbl">{m} <span className="n">{list.length}</span></div>
          <div className="card">
            {list.map((o, i) => (
              <div className={`doc${i === 0 ? ' first' : ''}`} key={o.id}>
                {selectable(o)
                  ? <input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Выбрать заказ ${o.number} для общего счёта`} style={{ width: 20, height: 20, flexShrink: 0, accentColor: 'var(--ink)' }} />
                  : <div className="fi">{o.lane === 'quote' || o.lane === 'submitted' ? 'КП' : '№'}</div>}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="fn">{o.lane === 'quote' ? 'Просчёт' : 'Заказ'} {o.number} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· ваш № {o.clientOrderNumber || 'не указан'}</span> · {fmtMoney(o.amount)}</div>
                  <div className="fm">от {fmtDate(o.created_at)}{o.summary ? ` · ${o.summary}` : ''}{o.positions ? ` · ${o.positions} поз.` : ''}</div>
                  {(payBadge(o) || shipBadge(o)) && (
                    <div className="pills">
                      {[payBadge(o), shipBadge(o)].filter(b => b !== null).map(b => <span key={b.label} className={`pill ${TONE_CLASS[b.tone]}`}>{b.label}</span>)}
                    </div>
                  )}
                </div>
                <div className="dset">
                  <DownloadMenu items={dlItems(o)} />
                  <Link className="dl" href={`/partner/order/${o.id}/kp`}>КП</Link>
                  {inInvoice.has(o.id)
                    ? <Link className="dl" href={`/partner/invoices/${inInvoice.get(o.id)!.id}`}>Общий счёт № {inInvoice.get(o.id)!.no}</Link>
                    : o.invoice === 'open'
                    ? <Link className="dl" href={`/partner/order/${o.id}/invoice`}>Счёт</Link>
                    : <span className="dno">{INVOICE_HINT[o.invoice]}</span>}
                  {o.upd
                    ? <Link className="dl" href={`/partner/order/${o.id}/upd`}>УПД № {o.upd.number} от {fmtDate(o.upd.docDate)}</Link>
                    : <span className="dno">{updHint(o)}</span>}
                </div>
              </div>
            ))}
          </div>
          </div>
        ))}
      </div>
    </>
  )
}
