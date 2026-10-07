'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { loadJson, responseError, NETWORK_ERROR, toast } from '@/lib/toast'
import {
  CLAIM_CAUSES, CLAIM_CAUSE_LABEL, CLAIM_STATUSES, CLAIM_STATUS_LABEL, causeSummary,
  type ClaimCause, type ClaimStatus,
} from '@/lib/partner/claims'

// Очередь гарантийных обращений партнёров. Владелец ставит статус, пишет ответ (его
// партнёр видит в /partner/claims) и причину — «вина размера» нужна метрике точки Т5.

type Claim = {
  id: number; clientId: number; clientName: string; isPoint: boolean
  orderId: number | null; orderNumber: string | null
  kind: string; kindLabel: string; description: string
  status: string; resolution: string | null; cause: string | null
  createdAt: string; resolvedAt: string | null
}
type Resp = { claims: Claim[]; causeReady: boolean }
type Draft = { status: ClaimStatus; resolution: string; cause: ClaimCause | '' }
type Filter = 'open' | 'all'

const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: '2-digit' })
const asStatus = (s: string): ClaimStatus => ((CLAIM_STATUSES as readonly string[]).includes(s) ? s : 'open') as ClaimStatus
const asCause = (s: string | null): ClaimCause | '' => ((CLAIM_CAUSES as readonly string[]).includes(String(s)) ? s : '') as ClaimCause | ''
const STATUS_CLS: Record<ClaimStatus, string> = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  in_review: 'bg-blue-50 text-blue-700 border-blue-200',
  resolved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-[#f0f0ec] text-[#6b6b66] border-[#e4e4e0]',
}

export default function ClaimsClient() {
  const [data, setData] = useState<Resp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [saving, setSaving] = useState<number | null>(null)
  const [rowErr, setRowErr] = useState<Record<number, string>>({})

  useEffect(() => {
    let alive = true
    loadJson<Resp>('/api/b2b-claims').then(r => {
      if (!alive) return
      if (r.error !== null) { setError(r.error); return }
      setData(r.data)
      setDrafts(Object.fromEntries(r.data.claims.map(c => [c.id, { status: asStatus(c.status), resolution: c.resolution ?? '', cause: asCause(c.cause) }])))
    })
    return () => { alive = false }
  }, [])

  const claims = useMemo(() => (data?.claims ?? []).filter(c => filter === 'all' || c.status === 'open' || c.status === 'in_review'), [data, filter])
  const openCount = (data?.claims ?? []).filter(c => c.status === 'open' || c.status === 'in_review').length
  const summary = useMemo(() => causeSummary((data?.claims ?? []).map(c => ({ cause: asCause(c.cause) || null }))), [data])

  function edit(id: number, patch: Partial<Draft>) {
    setDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }))
    setRowErr(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  async function save(c: Claim) {
    const d = drafts[c.id]
    if (!d) return
    setSaving(c.id)
    try {
      const r = await fetch('/api/b2b-claims', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, status: d.status, resolution: d.resolution, ...(data?.causeReady ? { cause: d.cause || null } : {}) }),
      })
      if (!r.ok) { const why = await responseError(r); setRowErr(prev => ({ ...prev, [c.id]: `Не сохранено: ${why}` })); return }
      const j = await r.json() as { claim: { status: string; resolution: string | null; resolved_at: string | null } }
      setData(prev => prev ? { ...prev, claims: prev.claims.map(x => x.id === c.id ? { ...x, status: j.claim.status, resolution: j.claim.resolution, resolvedAt: j.claim.resolved_at, cause: data?.causeReady ? (d.cause || null) : x.cause } : x) } : prev)
      toast.success('Сохранено — партнёр увидит статус и ответ в кабинете')
    } catch {
      setRowErr(prev => ({ ...prev, [c.id]: `Не сохранено: ${NETWORK_ERROR}` }))
    } finally { setSaving(null) }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 text-[#111110]">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[20px] font-semibold">Гарантийные обращения партнёров</h1>
          <p className="text-[13px] text-[#9a9a95]">Статус и ответ партнёр видит в своём кабинете при заходе — уведомлений не отправляем.</p>
        </div>
        <div className="flex gap-1 text-[13px]">
          {(['open', 'all'] as Filter[]).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg border ${filter === f ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66] hover:bg-[#f5f5f3]'}`}>
              {f === 'open' ? `Открытые · ${openCount}` : `Все · ${data?.claims.length ?? 0}`}
            </button>
          ))}
        </div>
      </div>

      {data && (
        <div className="mb-4 rounded-xl border border-[#e4e4e0] bg-white px-4 py-3 text-[13px]">
          {data.causeReady ? (
            <span>Причины (для Т5): вина размера — <b>{summary.size}</b> · брак — <b>{summary.defect}</b> · доставка — <b>{summary.transport}</b> · другое — <b>{summary.other}</b> · не указана — <b>{summary.none}</b></span>
          ) : (
            <span className="text-amber-700">Выбор причины («вина размера» / брак) включится после SQL владельца: <code>supabase/migrations/20261008_partner_claims_cause.sql</code>. Статус и ответ работают уже сейчас.</span>
          )}
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">Обращения не загрузились: {error}</div>}
      {!error && !data && <div className="text-[13px] text-[#9a9a95]">Загрузка…</div>}
      {data && claims.length === 0 && <div className="rounded-xl border border-[#e4e4e0] bg-white px-4 py-6 text-center text-[13px] text-[#9a9a95]">{filter === 'open' ? 'Открытых обращений нет.' : 'Обращений пока не было.'}</div>}

      <div className="space-y-3">
        {claims.map(c => {
          const d = drafts[c.id]
          const st = asStatus(c.status)
          const dirty = d && (d.status !== st || d.resolution !== (c.resolution ?? '') || d.cause !== asCause(c.cause))
          return (
            <div key={c.id} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold">
                    {c.kindLabel}
                    <span className="font-normal text-[#9a9a95]"> · {c.clientName}{c.isPoint ? ' · точка' : ''}</span>
                    {c.orderId && <> · <Link href={`/b2b-deal/${c.orderId}`} className="font-normal text-blue-700 hover:underline">заказ {c.orderNumber}</Link></>}
                  </div>
                  <div className="text-[12px] text-[#9a9a95]">от {fmtDate(c.createdAt)}{c.resolvedAt ? ` · закрыто ${fmtDate(c.resolvedAt)}` : ''}</div>
                  <div className="mt-1 text-[13px] text-[#3a3a38] whitespace-pre-wrap">{c.description}</div>
                </div>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CLS[st]}`}>{CLAIM_STATUS_LABEL[st]}</span>
              </div>

              {d && (
                <div className="mt-3 grid gap-2 sm:grid-cols-[180px_1fr]">
                  <select value={d.status} onChange={e => edit(c.id, { status: e.target.value as ClaimStatus })}
                    className="rounded-lg border border-[#e4e4e0] bg-white px-2 py-1.5 text-[13px]">
                    {CLAIM_STATUSES.map(s => <option key={s} value={s}>{CLAIM_STATUS_LABEL[s]}</option>)}
                  </select>
                  <select value={d.cause} disabled={!data?.causeReady} onChange={e => edit(c.id, { cause: e.target.value as ClaimCause | '' })}
                    title={data?.causeReady ? 'Причина по итогам разбора' : 'Появится после SQL владельца'}
                    className="rounded-lg border border-[#e4e4e0] bg-white px-2 py-1.5 text-[13px] disabled:opacity-50">
                    <option value="">Причина — не указана</option>
                    {CLAIM_CAUSES.map(k => <option key={k} value={k}>{CLAIM_CAUSE_LABEL[k]}</option>)}
                  </select>
                  <textarea value={d.resolution} onChange={e => edit(c.id, { resolution: e.target.value })} rows={2} maxLength={2000}
                    placeholder="Ответ партнёру — его видно в кабинете (обязателен, чтобы закрыть)"
                    className="sm:col-span-2 rounded-lg border border-[#e4e4e0] px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
                    <button onClick={() => void save(c)} disabled={!dirty || saving === c.id}
                      className="rounded-lg bg-[#111110] px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">
                      {saving === c.id ? 'Сохраняю…' : 'Сохранить'}
                    </button>
                    {rowErr[c.id] && <span className="text-[12px] text-red-700">{rowErr[c.id]}</span>}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
