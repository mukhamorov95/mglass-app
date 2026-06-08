'use client'

import { useState } from 'react'

// ─── Types mirrored from b2bQuickQuoteTool ────────────────────────────────────

type ProductType = 'mirror' | 'shower' | 'loft'
type MirrorType  = 'silver' | 'crystal_vision' | 'bronze' | 'graphite'

type FormState = {
  product_type:              ProductType
  width:                     string
  height:                    string
  quantity:                  string
  mirrorType:                MirrorType
  thicknessMm:               '4' | '5' | '6'
  hasLighting:               boolean
  partner_discount_override: string
  raw_request:               string
  manager_notes:             string
}

type QuoteItem = {
  line_item:    string
  dimensions?:  string
  quantity:     number
  unit_price:   number
  total_price:  number
}

type QuotePricing = {
  subtotal:          number
  discount_percent:  number
  discount_amount:   number
  final_total:       number
  currency:          string
  vat_included:      boolean
}

type ManagerInternal = {
  margin_estimate:  number | null
  margin_status:    'green' | 'yellow' | 'red' | 'unknown'
  cost_basis?:      number
  warnings:         string[]
  partner_context: {
    partner_discount:        number
    partner_discount_source: string
  }
}

type QuoteResult = {
  ok:                   boolean
  input_summary:        string
  items:                QuoteItem[]
  pricing:              QuotePricing | null
  client_message_draft: string | null
  manager_internal:     ManagerInternal | null
  missing_data:         string[]
  warnings:             string[]
  errors:               Array<{ code: string; message: string; field?: string }>
}

// ─── Initial form ─────────────────────────────────────────────────────────────

const INITIAL: FormState = {
  product_type:              'mirror',
  width:                     '',
  height:                    '',
  quantity:                  '1',
  mirrorType:                'silver',
  thicknessMm:               '4',
  hasLighting:               false,
  partner_discount_override: '',
  raw_request:               '',
  manager_notes:             '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽'
}

function MarginBadge({ status, estimate }: { status: string; estimate: number | null }) {
  const colors: Record<string, string> = {
    green:   'bg-green-50 text-green-700 border-green-200',
    yellow:  'bg-yellow-50 text-yellow-700 border-yellow-200',
    red:     'bg-red-50 text-red-700 border-red-200',
    unknown: 'bg-gray-50 text-gray-500 border-gray-200',
  }
  const cls = colors[status] ?? colors.unknown
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${cls}`}>
      {status === 'green' ? '▲' : status === 'red' ? '▼' : '◆'}
      {estimate != null ? `${estimate.toFixed(1)}%` : status}
    </span>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIB2BQuotePage() {
  const [form,    setForm]    = useState<FormState>(INITIAL)
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<QuoteResult | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [copied,  setCopied]  = useState(false)

  const set = <K extends keyof FormState>(k: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setResult(null); setError(null)

    const body: Record<string, unknown> = {
      product_type: form.product_type,
      width:        Number(form.width),
      height:       Number(form.height),
      quantity:     form.quantity ? Number(form.quantity) : 1,
    }
    if (form.product_type === 'mirror') {
      body.mirrorType   = form.mirrorType
      body.thicknessMm  = Number(form.thicknessMm)
      body.hasLighting  = form.hasLighting
    }
    if (form.partner_discount_override) {
      body.partner_discount_override = Number(form.partner_discount_override)
    }
    if (form.raw_request.trim())    body.raw_request    = form.raw_request.trim()
    if (form.manager_notes.trim())  body.manager_notes  = form.manager_notes.trim()

    try {
      const res = await fetch('/api/ai/b2b-quote/draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const data: QuoteResult = await res.json()
      setResult(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка запроса')
    } finally {
      setLoading(false)
    }
  }

  async function copyDraft() {
    if (!result?.client_message_draft) return
    try {
      await navigator.clipboard.writeText(result.client_message_draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Скопируйте текст:', result.client_message_draft)
    }
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      {/* Header */}
      <div className="px-6 py-5 border-b border-[#e4e4e0] bg-white sticky top-0 z-10">
        <h1 className="text-[18px] font-semibold text-[#111110]">B2B Quick Quote</h1>
        <p className="text-[12px] text-[#9a9a95]">Быстрый расчёт цены для партнёра — только просмотр, без отправки</p>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <form onSubmit={submit} className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-4 self-start">
          <p className="text-[13px] font-semibold text-[#111110]">Параметры запроса</p>

          {/* product_type */}
          <Field label="Тип продукта">
            <select value={form.product_type} onChange={set('product_type')} className={SEL}>
              <option value="mirror">Зеркало</option>
              <option value="shower">Душевое стекло</option>
              <option value="loft">Лофт-перегородка</option>
            </select>
          </Field>

          {/* dimensions */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ширина (мм)">
              <input type="number" required min={1} value={form.width} onChange={set('width')} placeholder="800" className={INP} />
            </Field>
            <Field label="Высота (мм)">
              <input type="number" required min={1} value={form.height} onChange={set('height')} placeholder="600" className={INP} />
            </Field>
          </div>

          {/* quantity */}
          <Field label="Количество">
            <input type="number" min={1} value={form.quantity} onChange={set('quantity')} className={INP} />
          </Field>

          {/* mirror-specific */}
          {form.product_type === 'mirror' && (
            <div className="space-y-3 border-t border-[#f0f0ec] pt-3">
              <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Зеркало</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Тип зеркала">
                  <select value={form.mirrorType} onChange={set('mirrorType')} className={SEL}>
                    <option value="silver">Сильвер</option>
                    <option value="crystal_vision">Crystal Vision</option>
                    <option value="bronze">Бронза</option>
                    <option value="graphite">Графит</option>
                  </select>
                </Field>
                <Field label="Толщина (мм)">
                  <select value={form.thicknessMm} onChange={set('thicknessMm')} className={SEL}>
                    <option value="4">4 мм</option>
                    <option value="5">5 мм</option>
                    <option value="6">6 мм</option>
                  </select>
                </Field>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.hasLighting} onChange={set('hasLighting')} className="w-4 h-4 rounded border-[#e4e4e0]" />
                <span className="text-[13px] text-[#111110]">С подсветкой</span>
              </label>
            </div>
          )}

          {/* partner discount */}
          <div className="border-t border-[#f0f0ec] pt-3">
            <Field label="Партнёрская скидка (%, необязательно)">
              <input type="number" min={0} max={100} value={form.partner_discount_override} onChange={set('partner_discount_override')} placeholder="0" className={INP} />
            </Field>
          </div>

          {/* context */}
          <Field label="Текст запроса от партнёра (необязательно)">
            <textarea value={form.raw_request} onChange={set('raw_request')} rows={2} placeholder="Напр.: нужно зеркало 80×60 сильвер, без подсветки, 5 шт" className={`${INP} resize-none`} />
          </Field>
          <Field label="Заметки менеджера (необязательно)">
            <textarea value={form.manager_notes} onChange={set('manager_notes')} rows={2} placeholder="Напр.: клиент торгуется, звонил сам" className={`${INP} resize-none`} />
          </Field>

          <button type="submit" disabled={loading || !form.width || !form.height}
            className="w-full bg-[#111110] text-white text-[13px] font-medium rounded-lg py-2.5 hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {loading ? 'Считаем...' : 'Рассчитать цену'}
          </button>

          <p className="text-[10px] text-[#9a9a95] text-center">
            Расчёт только для просмотра. Клиенту ничего не отправляется.
          </p>
        </form>

        {/* Result */}
        <div className="space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-[13px] text-red-700">
              ⚠ {error}
            </div>
          )}

          {result && (
            <>
              {/* Status banner */}
              <div className={`rounded-xl border p-4 ${result.ok ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                <p className="text-[12px] font-semibold text-[#111110]">{result.ok ? '✓ Расчёт готов' : '✗ Расчёт не удался'}</p>
                {result.input_summary && <p className="text-[11px] text-[#6b6b66] mt-0.5">{result.input_summary}</p>}
              </div>

              {/* Items table */}
              {result.items.length > 0 && (
                <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <p className="px-4 py-3 text-[12px] font-bold text-[#8a8a85] uppercase tracking-wide border-b border-[#f0f0ec]">Позиции</p>
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec]">
                        <th className="text-left px-4 py-2 text-[#9a9a95] font-medium">Позиция</th>
                        <th className="text-right px-4 py-2 text-[#9a9a95] font-medium">Кол.</th>
                        <th className="text-right px-4 py-2 text-[#9a9a95] font-medium">Цена</th>
                        <th className="text-right px-4 py-2 text-[#9a9a95] font-medium">Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((it, i) => (
                        <tr key={i} className="border-b border-[#f8f8f7]">
                          <td className="px-4 py-2 text-[#111110]">
                            {it.line_item}
                            {it.dimensions && <span className="text-[#9a9a95] ml-1">{it.dimensions}</span>}
                          </td>
                          <td className="px-4 py-2 text-right text-[#6b6b66]">{it.quantity}</td>
                          <td className="px-4 py-2 text-right text-[#6b6b66]">{fmt(it.unit_price)}</td>
                          <td className="px-4 py-2 text-right font-semibold text-[#111110]">{fmt(it.total_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pricing */}
              {result.pricing && (
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-1.5">
                  <p className="text-[12px] font-bold text-[#8a8a85] uppercase tracking-wide mb-2">Итоговая цена</p>
                  <PRow label="Подитог" value={fmt(result.pricing.subtotal)} />
                  {result.pricing.discount_percent > 0 && (
                    <PRow label={`Скидка ${result.pricing.discount_percent}%`} value={`−${fmt(result.pricing.discount_amount)}`} highlight="text-red-600" />
                  )}
                  <div className="border-t border-[#f0f0ec] pt-1.5">
                    <PRow label="ИТОГО" value={fmt(result.pricing.final_total)} bold />
                  </div>
                  <p className="text-[10px] text-[#9a9a95]">{result.pricing.vat_included ? 'НДС включён' : 'Без НДС'}</p>
                </div>
              )}

              {/* Manager internal */}
              {result.manager_internal && (
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[12px] font-bold text-[#8a8a85] uppercase tracking-wide mb-2">Для менеджера</p>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[12px] text-[#6b6b66]">Маржа:</span>
                    <MarginBadge status={result.manager_internal.margin_status} estimate={result.manager_internal.margin_estimate} />
                  </div>
                  {result.manager_internal.cost_basis != null && (
                    <p className="text-[11px] text-[#9a9a95]">Себестоимость: {fmt(result.manager_internal.cost_basis)}</p>
                  )}
                  <p className="text-[11px] text-[#9a9a95] mt-1">
                    Скидка: {result.manager_internal.partner_context.partner_discount}% ({result.manager_internal.partner_context.partner_discount_source})
                  </p>
                  {result.manager_internal.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {result.manager_internal.warnings.map((w, i) => (
                        <li key={i} className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5">⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* Client message draft */}
              {result.client_message_draft && (
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[12px] font-bold text-[#8a8a85] uppercase tracking-wide">Черновик для партнёра</p>
                    <button onClick={copyDraft}
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#f0f0ec] hover:bg-[#e8e8e4] text-[#6b6b66] transition-colors">
                      {copied ? '✓ Скопировано' : 'Копировать'}
                    </button>
                  </div>
                  <pre className="text-[12px] text-[#111110] whitespace-pre-wrap font-sans leading-relaxed">{result.client_message_draft}</pre>
                  <p className="text-[10px] text-[#9a9a95] mt-2">Черновик. Требует проверки и согласования перед отправкой.</p>
                </div>
              )}

              {/* Warnings */}
              {result.warnings.length > 0 && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-amber-700 mb-1">Предупреждения</p>
                  <ul className="space-y-0.5">
                    {result.warnings.map((w, i) => <li key={i} className="text-[11px] text-amber-700">• {w}</li>)}
                  </ul>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-4">
                  <p className="text-[11px] font-bold text-red-700 mb-1">Ошибки</p>
                  <ul className="space-y-0.5">
                    {result.errors.map((e, i) => <li key={i} className="text-[11px] text-red-700">• [{e.code}] {e.message}</li>)}
                  </ul>
                </div>
              )}

              {/* Safety notice */}
              <div className="text-[10px] text-[#9a9a95] text-center py-2">
                approval_required · can_send_to_client: false · can_write_crm: false · no model call
              </div>
            </>
          )}

          {!result && !loading && !error && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center">
              <p className="text-[13px] text-[#9a9a95]">Заполните форму и нажмите «Рассчитать цену»</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

const INP = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]'
const SEL = `${INP} cursor-pointer`

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-bold text-[#8a8a85] uppercase tracking-wide mb-1">{label}</label>
      {children}
    </div>
  )
}

function PRow({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: string }) {
  return (
    <div className="flex justify-between gap-2 text-[13px]">
      <span className="text-[#9a9a95]">{label}</span>
      <span className={`${bold ? 'font-bold text-[#111110]' : 'text-[#6b6b66]'} ${highlight ?? ''}`}>{value}</span>
    </div>
  )
}
