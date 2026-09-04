'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { formatPhone } from '@/lib/b2c/phoneKey'
import { dealStage } from '@/lib/b2c/dealStatus'

// Карточка Сделки (B2C). Паттерн — как /b2b-deal, но модель своя (deals — тонкая
// группировка по объекту). Статус — производная от расчётов (dealStage), не хранится.

type Deal = {
  id: number; client_name: string; phone: string; address: string
  manager_id: string | null; amo_lead_id: string | null; created_by_name: string | null
  created_at: string; updated_at: string
}
type Calc = {
  id: number; product_type: string; final_price: number; margin: number
  status: string; created_at: string; client_name: string | null; client_phone: string | null; parent_calc_id: number | null
  input_data?: Record<string, unknown>
}
type Doc = { id: number; number: string; total: number; status: string; manager_name: string | null; created_at: string }
type Contract = Doc & { kp_id: number | null; make_sum: number | null; install_sum: number | null }
type Invoice = { id: number; invoice_no: string; amount: number; status: string; issued_at: string | null; paid_at: string | null }
type Measure = { id: number; status: string; scope: string | null; measurer_name: string | null; scheduled_at: string | null; photos: string[] | null; created_at: string }
type Payment = { id: number; kind: string; amount: number; paid_at: string; entered_by_name: string | null; note: string | null }
type DealFile = { id: number; kind: string; url: string; name: string | null; uploaded_by_name: string | null; created_at: string }

// Слова владельца дословно — не «частичная оплата 1/2/3».
const PAY_KIND: { key: string; label: string }[] = [
  { key: 'prepay', label: 'Предоплата' },
  { key: 'balance', label: 'Остаток' },
  { key: 'install', label: 'Остаток за монтаж' },
]
const payLabel = (k: string) => PAY_KIND.find(x => x.key === k)?.label ?? k

const DOC_STATUS: Record<string, string> = { draft: 'Черновик', final: 'Готово', sent: 'Отправлен', signed: 'Подписан', issued: 'Выставлен', paid: 'Оплачен', cancelled: 'Отменён' }
const MEASURE_STATUS: Record<string, { label: string; tone: string; emoji: string }> = {
  new:       { label: 'Заявка отправлена', tone: 'bg-amber-50 text-amber-700',   emoji: '🆕' },
  scheduled: { label: 'Замер назначен',    tone: 'bg-blue-50 text-blue-700',     emoji: '🗓' },
  done:      { label: 'Замер выполнен',    tone: 'bg-emerald-50 text-emerald-700', emoji: '✅' },
  issue:     { label: 'Проблема на замере', tone: 'bg-red-50 text-red-700',       emoji: '⚠️' },
  cancelled: { label: 'Замер отменён',     tone: 'bg-[#f0f0ec] text-[#6b6b66]',   emoji: '✕' },
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const date = (s: string) => new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })
const PRODUCT: Record<string, string> = { mirror: '🪞 Зеркало', shower: '🚿 Душевая', shower_standard: '🚿 Душевая', shower_budget: '🚿 Душевая', loft: '🏗️ Лофт', railing: '🪜 Ограждение', quick: '⚡ Быстрый' }
const CALC_STATUS: Record<string, string> = { draft: 'Черновик', sent: 'Отправлено', approved: 'Согласовано', rejected: 'Отказ' }

const TONE: Record<string, string> = {
  plain: 'bg-[#f0f0ec] text-[#6b6b66]', sent: 'bg-blue-50 text-blue-700', good: 'bg-emerald-50 text-emerald-700',
}

export default function DealPage() {
  const params = useParams()
  const id = Number(params.id)
  const [deal, setDeal] = useState<Deal | null>(null)
  const [calcs, setCalcs] = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState({ client_name: '', phone: '', address: '', amo_lead_id: '' })
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'calcs' | 'docs' | 'money'>('calcs')
  const [docs, setDocs] = useState<{ kps: Doc[]; contracts: Contract[]; invoices: Invoice[]; measures: Measure[] } | null>(null)
  const [measuring, setMeasuring] = useState(false)
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [files, setFiles] = useState<DealFile[] | null>(null)
  const [payForm, setPayForm] = useState({ kind: 'prepay', amount: '', paid_at: new Date().toISOString().slice(0, 10) })
  const [payingSave, setPayingSave] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/deals/${id}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этой сделке' : 'Сделка не найдена'); return }
      setDeal(j.deal); setCalcs(j.calculations ?? [])
      setForm({ client_name: j.deal.client_name ?? '', phone: j.deal.phone ?? '', address: j.deal.address ?? '', amo_lead_id: j.deal.amo_lead_id ?? '' })
      setError(null)
      loadDocs()      // документы и замер грузим сразу — блок замера виден без открытия вкладки
      loadPayments()  // оплаты — для вкладки «Деньги»
      loadFiles()     // чертёж и файлы сделки
    } catch { setError('Сеть недоступна') } finally { setLoading(false) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { if (id) load() }, [id])

  // С доски приходят на конкретный шаг: #docs — документы, #money — деньги.
  // Иначе «Отметить оплату» открывало карточку на расчётах и деньги надо было искать.
  useEffect(() => {
    const h = window.location.hash.replace('#', '')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (h === 'docs' || h === 'money') setTab(h)
  }, [])

  async function save() {
    setSaving(true)
    try {
      const r = await fetch(`/api/deals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
      if (r.ok) { setEdit(false); await load() }
    } finally { setSaving(false) }
  }

  // Открыть расчёт для пересчёта: снимок quick → sessionStorage, дальше калькулятор
  // восстановит поля. Открытие даёт НОВЫЙ расчёт (первичный остаётся в сделке).
  function reopenQuick(c: Calc) {
    if (!c.input_data) return
    // Несём контекст: __parentCalcId связывает вторичный расчёт с первичным,
    // __dealId кладёт пересчёт в ТУ ЖЕ сделку (тот же объект, не спрашиваем заново).
    const payload = { ...c.input_data, __parentCalcId: c.id, __dealId: deal!.id }
    try { sessionStorage.setItem('mglass_quick_reopen', JSON.stringify(payload)) } catch { /* ignore */ }
    window.location.assign('/calculator/quick')
  }

  async function detach(calcId: number) {
    await fetch(`/api/deals/${id}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: calcId, detach: true }) })
    await load()
  }

  async function loadDocs() {
    try {
      const r = await fetch(`/api/deals/${id}/documents`)
      const j = await r.json().catch(() => ({}))
      if (r.ok) setDocs({ kps: j.kps ?? [], contracts: j.contracts ?? [], invoices: j.invoices ?? [], measures: j.measures ?? [] })
    } catch { /* ignore */ }
  }
  function openTab(k: 'calcs' | 'docs' | 'money') { setTab(k) }

  // Отправить на замер: заявка с данными сделки. Замерщик увидит её в своём кабинете;
  // отметка и файлы вернутся сюда через deal_id.
  async function sendMeasure() {
    if (!deal) return
    // Адрес обязателен — иначе замерщику некуда ехать. Нет в сделке → спрашиваем и
    // записываем в саму сделку (по адресу ищут карточку — прямое требование владельца).
    let addr = (deal.address || '').trim()
    if (!addr) {
      const entered = window.prompt('Адрес объекта для замера (обязателен — замерщику нужно куда ехать):', '')
      addr = (entered || '').trim()
      if (!addr) return
      await fetch(`/api/deals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_name: deal.client_name, phone: deal.phone, address: addr, amo_lead_id: deal.amo_lead_id ?? '' }) })
    }
    setMeasuring(true)
    try {
      const r = await fetch(`/api/deals/${id}/measure`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: addr }) })
      if (r.ok) await load()
    } finally { setMeasuring(false) }
  }
  async function attachMeasure(reqId: number, file: File) {
    const fd = new FormData(); fd.append('file', file)
    const r = await fetch(`/api/measure-requests/${reqId}/photo`, { method: 'POST', body: fd })
    if (r.ok) await loadDocs()
  }

  async function loadPayments() {
    try {
      const r = await fetch(`/api/deals/${id}/payments`)
      const j = await r.json().catch(() => ({}))
      if (r.ok) setPayments(j.payments ?? [])
    } catch { /* ignore */ }
  }
  async function addPayment() {
    const amount = Number(String(payForm.amount).replace(/[^\d.]/g, ''))
    if (!(amount > 0)) return
    setPayingSave(true)
    try {
      const r = await fetch(`/api/deals/${id}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: payForm.kind, amount, paid_at: payForm.paid_at }),
      })
      if (r.ok) { setPayForm(f => ({ ...f, amount: '' })); await loadPayments() }
    } finally { setPayingSave(false) }
  }
  async function deletePayment(pid: number) {
    const r = await fetch(`/api/deals/${id}/payments`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id: pid }) })
    if (r.ok) await loadPayments()
  }

  async function loadFiles() {
    try {
      const r = await fetch(`/api/deals/${id}/files`)
      const j = await r.json().catch(() => ({}))
      if (r.ok) setFiles(j.files ?? [])
    } catch { /* ignore */ }
  }
  async function uploadFile(file: File) {
    const fd = new FormData(); fd.append('file', file); fd.append('kind', 'drawing')
    const r = await fetch(`/api/deals/${id}/files`, { method: 'POST', body: fd })
    if (r.ok) await loadFiles()
  }
  async function deleteFile(fid: number) {
    const r = await fetch(`/api/deals/${id}/files`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: fid }) })
    if (r.ok) await loadFiles()
  }

  // «Сделать КП» из карточки: клиент, адрес и позиции из расчётов сделки уже подставлены —
  // менеджер их вводил при просчёте, повторно не заставляем. deal_id несёт связь в КП.
  function makeKp() {
    if (!deal) return
    const items = calcs.map(c => {
      const name = (PRODUCT[c.product_type] ?? c.product_type) + (c.parent_calc_id ? ' (пересчёт)' : '')
      const sum = Math.round(Number(c.final_price) || 0)
      return { name, qty: 1, price: sum, sum }
    })
    const total = items.reduce((s, i) => s + i.sum, 0)
    const prefill = {
      title: (deal.client_name || 'Коммерческое предложение').toUpperCase(),
      items, subtotal: total, total,
      deal_id: deal.id, client_name: deal.client_name, client_phone: deal.phone, client_address: deal.address,
    }
    try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(prefill)) } catch { /* ignore */ }
    window.location.assign('/kp')
  }

  if (loading) return <div className="p-6 text-[13px] text-[#9a9a95]">Загрузка…</div>
  if (error || !deal) return (
    <div className="p-6">
      <p className="text-[14px] font-semibold text-[#111110]">{error ?? 'Сделка не найдена'}</p>
      <Link href="/deals" className="text-[13px] text-blue-600 hover:underline mt-2 inline-block">← К сделкам</Link>
    </div>
  )

  const stage = dealStage(calcs)
  const total = calcs.reduce((s, c) => s + (Number(c.final_price) || 0), 0)

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <div className="text-[13px]"><Link href="/deals" className="text-[#9a9a95] hover:text-[#6b6b66]">← Сделки</Link></div>

      <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[20px] font-bold text-[#111110]">{deal.client_name || 'Без имени'}</h1>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${TONE[stage.tone]}`}>{stage.label}</span>
            </div>
            <p className="text-[13px] text-[#6b6b66] mt-0.5">
              {deal.phone ? formatPhone(deal.phone) : 'телефон не указан'}{deal.address ? ` · ${deal.address}` : ''}
            </p>
            <p className="text-[11px] text-[#9a9a95] mt-0.5">
              создана {date(deal.created_at)}{deal.created_by_name ? ` · ${deal.created_by_name}` : ''}
              {deal.amo_lead_id ? ` · Amo: ${deal.amo_lead_id}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[18px] font-bold font-mono text-[#111110]">{fmt(total)}</p>
            <button onClick={() => setEdit(v => !v)} className="text-[12px] text-blue-600 hover:underline mt-1">
              {edit ? 'Отмена' : 'Изменить'}
            </button>
          </div>
        </div>

        {edit && (
          <div className="mt-3 pt-3 border-t border-[#f0f0ec] grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Клиент"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Телефон"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Адрес объекта"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.amo_lead_id} onChange={e => setForm(f => ({ ...f, amo_lead_id: e.target.value }))} placeholder="ID сделки в AmoCRM (привязать вручную)"
              className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            <div className="sm:col-span-2">
              <button onClick={save} disabled={saving}
                className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
                {saving ? 'Сохраняю…' : 'Сохранить'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Действия по сделке — документы и замер делаются отсюда, клиент уже подставлен. */}
      <div className="flex flex-wrap gap-2">
        <button onClick={makeKp} disabled={calcs.length === 0}
          className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
          📄 Сделать КП
        </button>
        <Link href="/contracts" className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f0f0ec]">
          📝 Договор
        </Link>
        <button onClick={sendMeasure} disabled={measuring}
          className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f0f0ec] disabled:opacity-40">
          {measuring ? 'Отправляю…' : '📐 Отправить на замер'}
        </button>
      </div>

      {/* Замер — состояние возвращается сюда через deal_id; файл прикладывается тут же. */}
      {docs && docs.measures.length > 0 && (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl px-5 py-4 space-y-2">
          {docs.measures.map(m => {
            const st = MEASURE_STATUS[m.status] ?? { label: m.status, tone: 'bg-[#f0f0ec] text-[#6b6b66]', emoji: '📐' }
            return (
              <div key={m.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${st.tone}`}>{st.emoji} {st.label}</span>
                  <span className="text-[11px] text-[#9a9a95]">
                    {m.scheduled_at ? `на ${date(m.scheduled_at)}` : date(m.created_at)}{m.measurer_name ? ` · ${m.measurer_name}` : ''}
                  </span>
                </div>
                {m.scope && <p className="text-[12px] text-[#6b6b66]">{m.scope}</p>}
                {Array.isArray(m.photos) && m.photos.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {m.photos.map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="text-[12px] text-blue-600 hover:underline">📎 файл {i + 1}</a>
                    ))}
                  </div>
                )}
                <label className="inline-block text-[12px] text-blue-600 hover:underline cursor-pointer">
                  + приложить файл замера
                  <input type="file" accept="image/*,application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) attachMeasure(m.id, f); e.target.value = '' }} />
                </label>
              </div>
            )
          })}
        </div>
      )}

      {/* Вкладки */}
      <div className="flex gap-1 border-b border-[#e4e4e0]">
        {([['calcs', `Расчёты (${calcs.length})`], ['docs', `Документы${docs ? ` (${docs.kps.length + docs.contracts.length})` : ''}`], ['money', 'Деньги']] as const).map(([k, label]) => (
          <button key={k} onClick={() => openTab(k)}
            className={`text-[13px] px-4 py-2 -mb-px border-b-2 transition-colors ${tab === k ? 'border-[#111110] text-[#111110] font-semibold' : 'border-transparent text-[#9a9a95] hover:text-[#6b6b66]'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'calcs' && (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
          {calcs.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Пока нет расчётов по этой сделке.</p>
          ) : (
            <div className="divide-y divide-[#f0f0ec]">
              {calcs.map((c, i) => (
                <div key={c.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] text-[#111110]">{PRODUCT[c.product_type] ?? c.product_type}</span>
                      <span className="text-[10px] text-[#9a9a95] bg-[#f5f5f3] px-1.5 py-0.5 rounded">{CALC_STATUS[c.status] ?? c.status}</span>
                      {i === 0 && calcs.length > 1 && <span className="text-[10px] text-[#9a9a95]">первичный</span>}
                      {c.parent_calc_id && <span className="text-[10px] text-blue-600">пересчёт</span>}
                    </div>
                    <p className="text-[11px] text-[#9a9a95] mt-0.5">{date(c.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold font-mono text-[#111110] whitespace-nowrap">{fmt(Number(c.final_price) || 0)}</span>
                    {c.product_type === 'quick' && (
                      <button onClick={() => reopenQuick(c)} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">Открыть</button>
                    )}
                    <button onClick={() => detach(c.id)} title="Убрать из сделки" className="text-[#c4c4be] hover:text-red-500">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden divide-y divide-[#f0f0ec]">
            {docs === null ? <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Загрузка…</p>
            : (docs.kps.length === 0 && docs.contracts.length === 0) ? (
              <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Пока нет документов. Нажмите «Сделать КП» — клиент и позиции подставятся из сделки.</p>
            ) : (
              <>
                {docs.kps.map(d => (
                  <div key={`kp${d.id}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div><span className="text-[13px] text-[#111110]">📄 КП №{d.number}</span>
                      <p className="text-[11px] text-[#9a9a95]">{date(d.created_at)} · {DOC_STATUS[d.status] ?? d.status}{d.manager_name ? ` · ${d.manager_name}` : ''}</p></div>
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold font-mono">{fmt(Number(d.total) || 0)}</span>
                      <Link href={`/kp/${d.id}/print`} className="text-[12px] text-[#6b6b66] hover:underline whitespace-nowrap">Открыть</Link>
                      {/* Итоговое КП — правкой этого (не заново): откроется на редактирование. */}
                      <Link href={`/kp?edit=${d.id}`} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">Изменить</Link>
                    </div>
                  </div>
                ))}
                {docs.contracts.map(d => (
                  <div key={`c${d.id}`} className="px-5 py-3 flex items-center justify-between gap-3">
                    <div><span className="text-[13px] text-[#111110]">📝 Договор №{d.number}</span>
                      <p className="text-[11px] text-[#9a9a95]">{date(d.created_at)} · {DOC_STATUS[d.status] ?? d.status}{d.kp_id ? ` · из КП` : ''}</p></div>
                    <span className="text-[13px] font-semibold font-mono">{fmt(Number(d.total) || 0)}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Чертёж и файлы сделки — видны менеджеру (и цеху по роли). */}
          <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
              <p className="text-[12px] font-semibold text-[#9a9a95] uppercase tracking-wider">Чертёж и файлы</p>
              <label className="text-[12px] text-blue-600 hover:underline cursor-pointer">
                + приложить
                <input type="file" accept="image/*,application/pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
              </label>
            </div>
            {files === null ? <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Загрузка…</p>
            : files.length === 0 ? <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Файлов нет. Приложите чертёж — он будет виден в сделке.</p>
            : (
              <div className="divide-y divide-[#f0f0ec]">
                {files.map(f => (
                  <div key={f.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-blue-600 hover:underline truncate">
                      📐 {f.name || 'файл'}
                    </a>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">{date(f.created_at)}{f.uploaded_by_name ? ` · ${f.uploaded_by_name}` : ''}</span>
                      <button onClick={() => deleteFile(f.id)} title="Удалить" className="text-[#c4c4be] hover:text-red-500">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'money' && (
        <div className="bg-white border border-[#e4e4e0] rounded-2xl overflow-hidden">
          {/* Оплаты прямо на сделке. Сумма свободная (не из %), отметок одного вида может
              быть несколько, дата — поступления денег (не записи). */}
          <div className="px-5 py-3 border-b border-[#f0f0ec] flex items-center justify-between">
            <p className="text-[12px] font-semibold text-[#9a9a95] uppercase tracking-wider">Оплаты</p>
            {payments && payments.length > 0 && (
              <p className="text-[13px] font-semibold font-mono text-[#111110]">
                поступило {fmt(payments.reduce((s, p) => s + (Number(p.amount) || 0), 0))}
              </p>
            )}
          </div>

          {payments === null ? <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Загрузка…</p>
          : payments.length === 0 ? <p className="px-5 py-4 text-[13px] text-[#9a9a95]">Оплат пока нет. Отметьте предоплату, остаток или остаток за монтаж ниже.</p>
          : (
            <div className="divide-y divide-[#f0f0ec]">
              {payments.map(p => (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <span className="text-[13px] text-[#111110]">{payLabel(p.kind)}</span>
                    <p className="text-[11px] text-[#9a9a95]">{date(p.paid_at)}{p.entered_by_name ? ` · ${p.entered_by_name}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-semibold font-mono text-[#111110]">{fmt(Number(p.amount) || 0)}</span>
                    <button onClick={() => deletePayment(p.id)} title="Удалить" className="text-[#c4c4be] hover:text-red-500">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Добавить оплату */}
          <div className="px-5 py-3 border-t border-[#f0f0ec] bg-[#fafaf9] grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end">
            <div>
              <label className="block text-[10px] text-[#9a9a95] mb-1">Вид</label>
              <select value={payForm.kind} onChange={e => setPayForm(f => ({ ...f, kind: e.target.value }))}
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] bg-white outline-none focus:border-[#111110]">
                {PAY_KIND.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[#9a9a95] mb-1">Сумма, ₽</label>
              <input value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))} inputMode="numeric" placeholder="0"
                className="w-full border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono outline-none focus:border-[#111110]" />
            </div>
            <div>
              <label className="block text-[10px] text-[#9a9a95] mb-1">Дата поступления</label>
              <input type="date" value={payForm.paid_at} onChange={e => setPayForm(f => ({ ...f, paid_at: e.target.value }))}
                className="border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
            </div>
            <button onClick={addPayment} disabled={payingSave || !(Number(String(payForm.amount).replace(/[^\d.]/g, '')) > 0)}
              className="text-[13px] font-semibold px-4 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
              {payingSave ? '…' : 'Отметить'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
