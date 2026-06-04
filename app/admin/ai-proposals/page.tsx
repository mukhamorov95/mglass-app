'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// ─── List types ───────────────────────────────────────────────────────────────

type ProposalListItem = {
  id: number
  created_at: string
  status: string
  proposal_title: string | null
  client_name: string | null
  action_type: string
  warnings: string[]
  errors: unknown[]
  approved_at: string | null
  rejected_at: string | null
  created_by: string | null
}

// ─── Form types ───────────────────────────────────────────────────────────────

type ProductType = 'shower' | 'mirror' | 'loft'

type MirrorType = 'silver' | 'crystal_vision'
type MirrorShape = 'rectangle' | 'circle' | 'oval'

type CreateFormFields = {
  client_request:        string
  product_type:          ProductType
  width:                 string
  height:                string
  quantity:              string
  client_name:           string
  installation_required: boolean
  delivery_required:     boolean
  manager_notes:         string
  // Mirror-specific fields (only used when product_type === 'mirror')
  mirrorType:            MirrorType
  thicknessMm:           number
  hasLighting:           boolean
  mirrorShape:           MirrorShape
}

const INITIAL_FORM: CreateFormFields = {
  client_request:        '',
  product_type:          'shower',
  width:                 '',
  height:                '',
  quantity:              '1',
  client_name:           '',
  installation_required: false,
  delivery_required:     false,
  manager_notes:         '',
  mirrorType:            'silver',
  thicknessMm:           4,
  hasLighting:           false,
  mirrorShape:           'rectangle',
}

type SubmitResult = { ok: boolean; id: number; status: string }

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_FILTERS = [
  { key: 'all',              label: 'Все' },
  { key: 'pending_approval', label: 'На проверке' },
  { key: 'approved',         label: 'Одобрено' },
  { key: 'rejected',         label: 'Отклонено' },
  { key: 'failed',           label: 'Ошибка' },
]

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  draft:            { cls: 'bg-gray-100 text-gray-500',       label: 'Черновик' },
  pending_approval: { cls: 'bg-amber-100 text-amber-700',     label: 'На проверке' },
  approved:         { cls: 'bg-emerald-100 text-emerald-700', label: 'Одобрено' },
  rejected:         { cls: 'bg-red-100 text-red-600',         label: 'Отклонено' },
  failed:           { cls: 'bg-red-50 text-red-400',          label: 'Ошибка' },
  archived:         { cls: 'bg-gray-100 text-gray-400',       label: 'Архив' },
}

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { cls: 'bg-gray-100 text-gray-400', label: status }
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIProposalsPage() {
  const router = useRouter()

  // ── List state ──────────────────────────────────────────────────────────────
  const [items,   setItems]   = useState<ProposalListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [filter,  setFilter]  = useState('all')

  // ── Form state ──────────────────────────────────────────────────────────────
  const [formOpen,   setFormOpen]   = useState(false)
  const [form,       setForm]       = useState<CreateFormFields>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [formError,  setFormError]  = useState<string | null>(null)
  const [formResult, setFormResult] = useState<SubmitResult | null>(null)

  // ── Load list ───────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const qs   = filter === 'all' ? '' : `&status=${filter}`
      const res  = await fetch(`/api/ai/proposals?limit=50${qs}`)
      const data = await res.json() as { ok: boolean; items?: ProposalListItem[]; error?: string }
      if (!res.ok || !data.ok) {
        setError(data.error ?? 'Не удалось загрузить список')
        setItems([])
      } else {
        setItems(data.items ?? [])
      }
    } catch {
      setError('Ошибка сети')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  // ── Form helpers ────────────────────────────────────────────────────────────
  function setField<K extends keyof CreateFormFields>(key: K, value: CreateFormFields[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function openForm() {
    setFormOpen(true)
    setFormError(null)
    setFormResult(null)
  }

  function closeForm() {
    setFormOpen(false)
    setFormError(null)
    setFormResult(null)
    setForm(INITIAL_FORM)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setFormResult(null)

    // Client-side validation
    if (!form.client_request.trim()) {
      setFormError('Укажите запрос клиента')
      return
    }
    const width    = parseFloat(form.width)
    const height   = parseFloat(form.height)
    const quantity = parseInt(form.quantity, 10)
    if (!isFinite(width) || width <= 0) {
      setFormError('Укажите ширину в мм (положительное число)')
      return
    }
    if (!isFinite(height) || height <= 0) {
      setFormError('Укажите высоту в мм (положительное число)')
      return
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      setFormError('Количество должно быть целым числом не менее 1')
      return
    }

    setSubmitting(true)
    try {
      const options: Record<string, unknown> = form.product_type === 'mirror'
        ? {
            mirrorType:   form.mirrorType,
            thicknessMm:  form.thicknessMm,
            hasLighting:  form.hasLighting,
            shape:        form.mirrorShape,
          }
        : { model: 'M2', tier: 'standard' }

      const payload: Record<string, unknown> = {
        client_request:        form.client_request.trim(),
        product_type:          form.product_type,
        width,
        height,
        quantity,
        installation_required: form.installation_required,
        delivery_required:     form.delivery_required,
        options,
      }
      if (form.client_name.trim())   payload.client_name   = form.client_name.trim()
      if (form.manager_notes.trim()) payload.manager_notes = form.manager_notes.trim()

      const res = await fetch('/api/ai/proposals/draft', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })

      type DraftResponse = {
        ok:      boolean
        id?:     number | null
        status?: string
        error?:  string
      }

      const data = await res.json() as DraftResponse

      if (!res.ok) {
        console.error('[CreateProposalForm] draft API error:', res.status, data)
        setFormError(
          res.status === 401 ? 'Вы не авторизованы' :
          res.status === 403 ? 'Доступ запрещён' :
          data.error ?? 'Не удалось создать черновик. Попробуйте ещё раз.',
        )
        return
      }

      if (!data.id) {
        console.error('[CreateProposalForm] no id in response:', data)
        setFormError('Сервер не вернул id черновика. Обратитесь к администратору.')
        return
      }

      const result: SubmitResult = {
        ok:     data.ok,
        id:     data.id,
        status: data.status ?? '',
      }
      setFormResult(result)
      setForm(INITIAL_FORM)
      await load()

      if (data.ok) {
        // Successful draft → navigate to detail page
        router.push(`/admin/ai-proposals/${data.id}`)
      }
      // ok=false but id present → keep form open, show formResult warning block
    } catch {
      setFormError('Ошибка сети. Проверьте соединение и попробуйте снова.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f7f7f6]">
      <div className="max-w-5xl mx-auto px-4 py-4">

        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-base font-semibold text-[#111110]">AI Черновики КП</h1>
            <p className="text-xs text-[#9a9a95] mt-0.5">
              Черновики, сгенерированные proposal-engineer агентом
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={formOpen ? closeForm : openForm}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors ${
                formOpen
                  ? 'bg-[#f0f0ee] border border-[#e0e0dc] text-[#4b4b47] hover:bg-[#e8e8e4]'
                  : 'bg-[#111110] text-white hover:bg-[#2a2a28]'
              }`}
            >
              {formOpen ? '✕ Закрыть' : '+ Создать AI-КП'}
            </button>
            <button
              onClick={load}
              className="h-7 px-2.5 rounded-lg text-[11px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-white transition-colors"
            >
              ↻ Обновить
            </button>
          </div>
        </div>

        {/* Safety notice */}
        <div className="mb-4 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
          <p className="text-xs text-amber-800">
            Утверждение здесь <strong>не отправляет</strong> КП клиенту.
            Это внутреннее подтверждение черновика для последующей ручной отправки.
          </p>
        </div>

        {/* Create form panel */}
        {formOpen && (
          <form onSubmit={handleSubmit} noValidate
            className="mb-4 bg-white rounded-xl border border-[#e8e8e5] p-4">

            <h2 className="text-sm font-semibold text-[#111110] mb-3">Создать AI-черновик КП</h2>

            {/* Inner safety block */}
            <div className="mb-4 px-3 py-2 bg-[#f7f7f6] border border-[#ebebea] rounded-lg">
              <p className="text-[11px] text-[#6b6b66]">
                Создание AI-КП <strong>не отправляет</strong> предложение клиенту,
                не пишет в CRM и не создаёт заказ.
                Черновик попадёт на внутреннюю проверку.
              </p>
            </div>

            {/* Validation / submit error */}
            {formError && (
              <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-[11px] text-red-600">{formError}</p>
              </div>
            )}

            {/* Failed-but-saved result */}
            {formResult && !formResult.ok && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between gap-3">
                <p className="text-[11px] text-amber-800">
                  Черновик создан со статусом «Ошибка». Откройте запись для просмотра деталей.
                </p>
                <Link
                  href={`/admin/ai-proposals/${formResult.id}`}
                  className="shrink-0 h-6 px-2.5 rounded-lg text-[11px] border border-amber-300 text-amber-800 hover:bg-amber-100 transition-colors inline-flex items-center"
                >
                  Открыть #{formResult.id}
                </Link>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3">

              {/* client_request */}
              <div>
                <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                  Запрос клиента <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={form.client_request}
                  onChange={e => setField('client_request', e.target.value)}
                  placeholder="Например: нужна душевая кабина без поддона, 120×80 см, с монтажом"
                  rows={3}
                  className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] placeholder-[#c0c0bc] focus:outline-none focus:border-[#b0b0aa] resize-none"
                />
              </div>

              {/* product_type + width + height */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                    Тип изделия <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={form.product_type}
                    onChange={e => setField('product_type', e.target.value as ProductType)}
                    className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] bg-white focus:outline-none focus:border-[#b0b0aa]"
                  >
                    <option value="shower">Душевая (shower)</option>
                    <option value="mirror">Зеркало (mirror)</option>
                    <option value="loft">Перегородка (loft)</option>
                  </select>
                  {form.product_type === 'mirror' && (
                    <p className="mt-1 text-[10px] text-blue-600">
                      Цена берётся из glass_price_matrix (тот же источник, что /calculator/mirror).
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                    Ширина (мм) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.width}
                    onChange={e => setField('width', e.target.value)}
                    placeholder="1200"
                    className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] placeholder-[#c0c0bc] focus:outline-none focus:border-[#b0b0aa]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                    Высота (мм) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.height}
                    onChange={e => setField('height', e.target.value)}
                    placeholder="2000"
                    className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] placeholder-[#c0c0bc] focus:outline-none focus:border-[#b0b0aa]"
                  />
                </div>
              </div>

              {/* Mirror-specific options — shown only for product_type=mirror */}
              {form.product_type === 'mirror' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 p-3 bg-[#f7f7f6] rounded-lg border border-[#ebebea]">
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-2">Параметры зеркала</p>
                  </div>

                  {/* mirrorType */}
                  <div className="col-span-2">
                    <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">Тип зеркала</label>
                    <select
                      value={form.mirrorType}
                      onChange={e => setField('mirrorType', e.target.value as MirrorType)}
                      className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] bg-white focus:outline-none focus:border-[#b0b0aa]"
                    >
                      <option value="silver">Серебро</option>
                      <option value="crystal_vision">Осветлённое</option>
                    </select>
                  </div>

                  {/* thicknessMm */}
                  <div>
                    <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">Толщина</label>
                    <select
                      value={form.thicknessMm}
                      onChange={e => setField('thicknessMm', Number(e.target.value))}
                      className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] bg-white focus:outline-none focus:border-[#b0b0aa]"
                    >
                      <option value={4}>4 мм</option>
                      <option value={6}>6 мм</option>
                    </select>
                  </div>

                  {/* mirrorShape */}
                  <div>
                    <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">Форма</label>
                    <select
                      value={form.mirrorShape}
                      onChange={e => setField('mirrorShape', e.target.value as MirrorShape)}
                      className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] bg-white focus:outline-none focus:border-[#b0b0aa]"
                    >
                      <option value="rectangle">Прямоугольное</option>
                      <option value="circle">Круглое</option>
                      <option value="oval">Овальное</option>
                    </select>
                  </div>

                  {/* hasLighting */}
                  <div className="col-span-2 sm:col-span-4">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={form.hasLighting}
                        onChange={e => setField('hasLighting', e.target.checked)}
                        className="w-3.5 h-3.5 accent-[#111110]"
                      />
                      <span className="text-[11px] text-[#4b4b47]">Подсветка</span>
                    </label>
                  </div>
                </div>
              )}

              {/* quantity + client_name */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                    Количество
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={form.quantity}
                    onChange={e => setField('quantity', e.target.value)}
                    className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] focus:outline-none focus:border-[#b0b0aa]"
                  />
                </div>

                <div className="col-span-1 sm:col-span-3">
                  <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                    Имя клиента
                  </label>
                  <input
                    type="text"
                    value={form.client_name}
                    onChange={e => setField('client_name', e.target.value)}
                    placeholder="Иван Петров"
                    className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] placeholder-[#c0c0bc] focus:outline-none focus:border-[#b0b0aa]"
                  />
                </div>
              </div>

              {/* Checkboxes */}
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.installation_required}
                    onChange={e => setField('installation_required', e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#111110]"
                  />
                  <span className="text-[11px] text-[#4b4b47]">Монтаж</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={form.delivery_required}
                    onChange={e => setField('delivery_required', e.target.checked)}
                    className="w-3.5 h-3.5 accent-[#111110]"
                  />
                  <span className="text-[11px] text-[#4b4b47]">Доставка</span>
                </label>
              </div>

              {/* manager_notes */}
              <div>
                <label className="block text-[11px] font-medium text-[#4b4b47] mb-1">
                  Заметки менеджера
                </label>
                <textarea
                  value={form.manager_notes}
                  onChange={e => setField('manager_notes', e.target.value)}
                  placeholder="Дополнительный контекст для AI (необязательно)…"
                  rows={2}
                  className="w-full rounded-lg border border-[#e8e8e5] px-3 py-2 text-[12px] text-[#111110] placeholder-[#c0c0bc] focus:outline-none focus:border-[#b0b0aa] resize-none"
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={submitting}
                  className="h-8 px-4 rounded-lg text-[12px] font-medium bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin inline-block" />
                      Создание…
                    </span>
                  ) : 'Создать черновик'}
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={closeForm}
                  className="h-8 px-3 rounded-lg text-[12px] border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3] disabled:opacity-50 transition-colors"
                >
                  Отмена
                </button>
              </div>

            </div>
          </form>
        )}

        {/* Filter tabs */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {STATUS_FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`h-7 px-3 rounded-lg text-[11px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-[#111110] text-white'
                  : 'bg-white border border-[#e8e8e5] text-[#6b6b66] hover:bg-[#f5f5f3]'
              }`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center gap-2 text-[#9a9a95] text-xs py-12 justify-center">
            <div className="w-4 h-4 border-2 border-[#d0d0cc] border-t-[#9a9a95] rounded-full animate-spin" />
            Загрузка...
          </div>
        ) : error ? (
          <div className="bg-white rounded-xl border border-red-100 px-4 py-8 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={load} className="mt-3 text-xs text-[#9a9a95] underline">Повторить</button>
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#e8e8e5] px-4 py-12 text-center">
            <p className="text-sm text-[#9a9a95]">Черновики не найдены</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#f0f0ee]">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide w-12">#</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Черновик</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Статус</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Создан</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide">Флаги</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-[#a8a8a3] uppercase tracking-wide"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f7f7f7]">
                {items.map(item => {
                  const badge     = statusBadge(item.status)
                  const warnCount = Array.isArray(item.warnings) ? item.warnings.length : 0
                  const errCount  = Array.isArray(item.errors)   ? item.errors.length   : 0
                  return (
                    <tr key={item.id} className="hover:bg-[#fafafa] transition-colors">
                      <td className="px-4 py-3 text-[11px] text-[#9a9a95] font-mono">{item.id}</td>
                      <td className="px-4 py-3">
                        <p className="text-[12px] font-medium text-[#111110] truncate max-w-xs">
                          {item.proposal_title ?? <span className="text-[#9a9a95] font-normal italic">Без названия</span>}
                        </p>
                        {item.client_name && (
                          <p className="text-[10px] text-[#9a9a95] mt-0.5">{item.client_name}</p>
                        )}
                        {item.created_by && (
                          <p className="text-[10px] text-[#b8b8b4] mt-0.5">{item.created_by}</p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[#6b6b66] whitespace-nowrap">
                        {fmtDate(item.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {warnCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                              {warnCount}W
                            </span>
                          )}
                          {errCount > 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500">
                              {errCount}E
                            </span>
                          )}
                          {warnCount === 0 && errCount === 0 && (
                            <span className="text-[10px] text-[#d0d0cc]">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/admin/ai-proposals/${item.id}`}
                          className="h-6 px-2.5 rounded-lg text-[11px] border border-[#e8e8e5] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors inline-flex items-center gap-1">
                          Открыть →
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer note */}
        {items.length > 0 && (
          <p className="mt-3 text-[10px] text-[#b8b8b4] text-center">
            Показано {items.length} записей · одобрение не отправляет КП клиенту
          </p>
        )}

      </div>
    </div>
  )
}
