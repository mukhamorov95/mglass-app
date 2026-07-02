'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { B2BService, B2BFilm } from '@/lib/types'
import { calcServiceCost, ProductionSettings, SizeTier, DEFAULT_PRODUCTION_SETTINGS } from '@/lib/calcServiceCost'

const TYPE_LABELS: Record<string, string> = {
  percent:    '% от цены изделия',
  per_m2:     '₽ × м² изделия',
  fixed:      '₽ фиксированно',
  calculated: 'Расчёт от трудозатрат',
  film:       'Приклейка плёнки',
}

type ServiceForm = {
  name: string
  type: B2BService['type']
  value: number
  cost_price: number
  description: string
  active: boolean
  sort_order: number
  time_minutes: number
  equipment_depr_rub: number
  consumables_cost_rub: number
  overhead_override_pct: string
  margin_override_pct: string
  sale_price_override: string
  size_tiers: SizeTier[]
  unit_label: string
}

const EMPTY_FORM: ServiceForm = {
  name: '', type: 'fixed', value: 0, cost_price: 0, description: '', active: true, sort_order: 0,
  time_minutes: 0, equipment_depr_rub: 0, consumables_cost_rub: 0,
  overhead_override_pct: '', margin_override_pct: '', sale_price_override: '',
  size_tiers: [], unit_label: '₽/шт',
}

type FilmForm = {
  name: string
  cost_price_per_m2: number
  sale_price_per_m2: number
  work_cost_per_m2: number
  work_sale_per_m2: number
  description: string
  active: boolean
  sort_order: number
}

const EMPTY_FILM_FORM: FilmForm = {
  name: '', cost_price_per_m2: 0, sale_price_per_m2: 0,
  work_cost_per_m2: 0, work_sale_per_m2: 0,
  description: '', active: true, sort_order: 0,
}

function fmtRub(n: number) { return n.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₽' }

export default function B2BServicesPage() {
  const [services, setServices]         = useState<B2BService[]>([])
  const [films, setFilms]               = useState<B2BFilm[]>([])
  const [loading, setLoading]           = useState(true)
  const [form, setForm]                 = useState<ServiceForm>(EMPTY_FORM)
  const [filmForm, setFilmForm]         = useState<FilmForm>(EMPTY_FILM_FORM)
  const [editingFilmId, setEditingFilmId] = useState<number | null>(null)
  const [filmSaving, setFilmSaving]     = useState(false)
  const [filmError, setFilmError]       = useState<string | null>(null)
  const [editingId, setEditingId]       = useState<number | null>(null)
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState<string | null>(null)

  // Помощник расчёта амортизации и расходников
  const [equipCost, setEquipCost]       = useState('')   // стоимость станка
  const [equipLife, setEquipLife]       = useState('5')  // срок службы, лет
  const [consUnit, setConsUnit]         = useState('')   // стоимость одного расходника
  const [consLife, setConsLife]         = useState('')   // ресурс в операциях

  // Production settings
  const [ps, setPs]                     = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [psSaving, setPsSaving]         = useState(false)
  const [psError, setPsError]           = useState<string | null>(null)
  const [psDirty, setPsDirty]           = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const supabase = createClient()
    const [{ data: svcs, error: svcsErr }, { data: psData }, { data: filmsData }] = await Promise.all([
      supabase.from('b2b_services').select('*').order('sort_order').order('name'),
      supabase.from('production_settings').select('*').eq('id', 1).maybeSingle(),
      supabase.from('b2b_films').select('*').order('sort_order').order('name'),
    ])
    if (svcsErr) setError(svcsErr.message)
    else setServices(svcs ?? [])
    if (psData) setPs(psData as ProductionSettings)
    setFilms((filmsData ?? []) as B2BFilm[])
    setLoading(false)
  }

  async function saveProductionSettings() {
    setPsSaving(true)
    setPsError(null)
    const supabase = createClient()
    const { error } = await supabase.from('production_settings').upsert({ id: 1, ...ps, updated_at: new Date().toISOString() })
    if (error) setPsError(error.message)
    else setPsDirty(false)
    setPsSaving(false)
  }

  function updatePs(field: keyof ProductionSettings, val: number) {
    setPs(prev => ({ ...prev, [field]: val }))
    setPsDirty(true)
  }

  // Derived production metrics
  const hourlyRate  = ps.worker_monthly_salary / (ps.working_days_per_month * ps.working_hours_per_day)
  const minuteRate  = hourlyRate / 60

  // Derived cost preview for form (calculated type)
  const formCostPreview = form.type === 'calculated'
    ? calcServiceCost(
        {
          time_minutes: form.time_minutes,
          equipment_depr_rub: form.equipment_depr_rub,
          consumables_cost_rub: form.consumables_cost_rub,
          overhead_override_pct: form.overhead_override_pct !== '' ? Number(form.overhead_override_pct) : null,
          margin_override_pct: form.margin_override_pct !== '' ? Number(form.margin_override_pct) : null,
          sale_price_override: form.sale_price_override !== '' ? Number(form.sale_price_override) : null,
          size_tiers: form.size_tiers,
        },
        ps,
        form.size_tiers.length > 0 ? 0 : undefined,
      )
    : null

  async function handleSave() {
    if (!form.name.trim()) return
    setSaving(true)
    setError(null)
    const supabase = createClient()

    const safeNum = (n: unknown, fallback = 0) => {
      const v = Number(n)
      return isFinite(v) && !isNaN(v) ? v : fallback
    }
    const payload: Record<string, unknown> = {
      name:               form.name.trim(),
      type:               form.type,
      value:              safeNum(form.type === 'calculated' ? (formCostPreview?.sale_price ?? form.value) : form.value),
      cost_price:         safeNum(form.type === 'calculated' ? (formCostPreview?.cost_price ?? form.cost_price) : form.cost_price),
      description:        form.description,
      active:             form.active,
      sort_order:         Number(form.sort_order) || 0,
      time_minutes:       Number(form.time_minutes) || 0,
      equipment_depr_rub: Number(form.equipment_depr_rub) || 0,
      consumables_cost_rub: Number(form.consumables_cost_rub) || 0,
      overhead_override_pct: form.overhead_override_pct !== '' ? Number(form.overhead_override_pct) : null,
      margin_override_pct:   form.margin_override_pct !== '' ? Number(form.margin_override_pct) : null,
      sale_price_override:   form.sale_price_override !== '' ? Number(form.sale_price_override) : null,
      size_tiers:  form.size_tiers,
      unit_label:  form.unit_label || '₽/шт',
    }

    if (editingId !== null) {
      const { error } = await supabase.from('b2b_services').update(payload).eq('id', editingId)
      if (error) { setError(error.message); setSaving(false); return }
      setEditingId(null)
    } else {
      const { error } = await supabase.from('b2b_services').insert(payload)
      if (error) { setError(error.message); setSaving(false); return }
    }
    setForm(EMPTY_FORM)
    await load()
    setSaving(false)
  }

  async function toggleActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('b2b_services').update({ active: !active }).eq('id', id)
    await load()
  }

  async function deleteService(id: number, name: string) {
    if (!confirm(`Удалить услугу «${name}»? Это действие нельзя отменить.`)) return
    const supabase = createClient()
    await supabase.from('b2b_services').delete().eq('id', id)
    if (editingId === id) { setEditingId(null); setForm(EMPTY_FORM) }
    await load()
  }

  async function handleSaveFilm() {
    if (!filmForm.name.trim()) return
    setFilmSaving(true)
    setFilmError(null)
    const supabase = createClient()
    const payload = {
      name: filmForm.name.trim(),
      cost_price_per_m2: filmForm.cost_price_per_m2,
      sale_price_per_m2: filmForm.sale_price_per_m2,
      work_cost_per_m2: filmForm.work_cost_per_m2,
      work_sale_per_m2: filmForm.work_sale_per_m2,
      description: filmForm.description.trim() || null,
      active: filmForm.active,
      sort_order: Number(filmForm.sort_order) || 0,
    }
    if (editingFilmId !== null) {
      const { error } = await supabase.from('b2b_films').update(payload).eq('id', editingFilmId)
      if (error) { setFilmError(error.message); setFilmSaving(false); return }
      setEditingFilmId(null)
    } else {
      const { error } = await supabase.from('b2b_films').insert(payload)
      if (error) { setFilmError(error.message); setFilmSaving(false); return }
    }
    setFilmForm(EMPTY_FILM_FORM)
    await load()
    setFilmSaving(false)
  }

  async function deleteFilm(id: number, name: string) {
    if (!confirm(`Удалить плёнку «${name}»? Это действие нельзя отменить.`)) return
    const supabase = createClient()
    await supabase.from('b2b_films').delete().eq('id', id)
    if (editingFilmId === id) { setEditingFilmId(null); setFilmForm(EMPTY_FILM_FORM) }
    await load()
  }

  async function toggleFilmActive(id: number, active: boolean) {
    const supabase = createClient()
    await supabase.from('b2b_films').update({ active: !active }).eq('id', id)
    await load()
  }

  function startEditFilm(f: B2BFilm) {
    setEditingFilmId(f.id)
    setFilmForm({
      name: f.name,
      cost_price_per_m2: f.cost_price_per_m2,
      sale_price_per_m2: f.sale_price_per_m2,
      work_cost_per_m2: f.work_cost_per_m2 ?? 0,
      work_sale_per_m2: f.work_sale_per_m2 ?? 0,
      description: f.description ?? '',
      active: f.active,
      sort_order: f.sort_order,
    })
    setFilmError(null)
  }

  function startEdit(s: B2BService) {
    setEditingId(s.id)
    setForm({
      name:                s.name,
      type:                s.type,
      value:               s.value,
      cost_price:          s.cost_price ?? 0,
      description:         s.description ?? '',
      active:              s.active,
      sort_order:          s.sort_order,
      time_minutes:        s.time_minutes ?? 0,
      equipment_depr_rub:  s.equipment_depr_rub ?? 0,
      consumables_cost_rub: s.consumables_cost_rub ?? 0,
      overhead_override_pct: s.overhead_override_pct != null ? String(s.overhead_override_pct) : '',
      margin_override_pct:   s.margin_override_pct != null ? String(s.margin_override_pct) : '',
      sale_price_override:   s.sale_price_override != null ? String(s.sale_price_override) : '',
      size_tiers:          s.size_tiers ?? [],
      unit_label:          s.unit_label ?? '₽/шт',
    })
    setError(null)
  }

  function addTier() {
    setForm(prev => ({
      ...prev,
      size_tiers: [...prev.size_tiers, { label: '', max_mm: null, time_minutes: 0, consumables_cost_rub: 0 }],
    }))
  }

  function updateTier(idx: number, field: keyof SizeTier, val: string) {
    setForm(prev => {
      const tiers = [...prev.size_tiers]
      if (field === 'label') tiers[idx] = { ...tiers[idx], label: val }
      else if (field === 'max_mm') tiers[idx] = { ...tiers[idx], max_mm: val === '' ? null : Number(val) }
      else if (field === 'time_minutes') tiers[idx] = { ...tiers[idx], time_minutes: Number(val) || 0 }
      else if (field === 'consumables_cost_rub') tiers[idx] = { ...tiers[idx], consumables_cost_rub: Number(val) || 0 }
      return { ...prev, size_tiers: tiers }
    })
  }

  function removeTier(idx: number) {
    setForm(prev => ({ ...prev, size_tiers: prev.size_tiers.filter((_, i) => i !== idx) }))
  }

  return (
    <div className="max-w-[860px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink tracking-tight">B2B Доп. услуги</h1>
        <p className="text-[13px] text-muted mt-0.5">Справочник услуг обработки + производственные настройки</p>
      </div>

      {/* ── Производственные настройки ── */}
      <div className="bg-surface border border-line rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[13px] font-semibold text-ink">Производственные настройки</h2>
            <p className="text-[11px] text-muted mt-0.5">Используются для автоматического расчёта себестоимости услуг</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted">Стоимость рабочего часа</div>
            <div className="text-[16px] font-semibold text-ink font-mono">{fmtRub(hourlyRate)}</div>
            <div className="text-[10px] text-[#b4b4ae]">Минута: {minuteRate.toFixed(2)} ₽</div>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-3 mb-4">
          {([
            { key: 'worker_monthly_salary',  label: 'З/п мастера (₽/мес)', placeholder: '60000', step: 1000 },
            { key: 'working_days_per_month', label: 'Раб. дней/мес', placeholder: '21', step: 1 },
            { key: 'working_hours_per_day',  label: 'Часов/день', placeholder: '8', step: 1 },
            { key: 'overhead_percent',       label: 'Накладные (%)', placeholder: '20', step: 1 },
            { key: 'default_margin_percent', label: 'Наценка (%)', placeholder: '40', step: 1 },
          ] as { key: keyof ProductionSettings; label: string; placeholder: string; step: number }[]).map(f => (
            <div key={f.key}>
              <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">{f.label}</label>
              <input type="number" min="0" step={f.step}
                className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono text-ink outline-none focus:border-ink"
                value={ps[f.key]}
                onChange={e => updatePs(f.key, Number(e.target.value))}
              />
            </div>
          ))}
        </div>
        {psError && <p className="text-[12px] text-red-600 mb-3">{psError}</p>}
        <button onClick={saveProductionSettings} disabled={psSaving || !psDirty}
          className="bg-ink text-white text-[12px] font-medium px-4 py-1.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
          {psSaving ? 'Сохранение...' : psDirty ? 'Сохранить настройки' : 'Настройки сохранены'}
        </button>
      </div>

      {/* ── Справка по типам ── */}
      <div className="bg-canvas border border-line rounded-xl px-4 py-3 mb-6 text-[12px] text-ink-soft space-y-1">
        <p><span className="font-semibold text-ink">% от цены изделия</span> — наценка за сложность (напр. 30% за непрямоугольную форму)</p>
        <p><span className="font-semibold text-ink">₽ × м²</span> — умножается на площадь (напр. пескоструй, полимер, триплекс)</p>
        <p><span className="font-semibold text-ink">₽ фиксированно</span> — фиксированная сумма × кол-во штук</p>
        <p><span className="font-semibold text-ink">Расчёт от трудозатрат</span> — себестоимость из нормы времени + амортизация + расходники + накладные. Поддерживает диапазоны по размеру.</p>
      </div>

      {/* ── Форма добавления/редактирования ── */}
      <div className={`rounded-xl border p-5 mb-8 transition-all ${editingId !== null ? 'bg-blue-50 border-blue-200' : 'bg-surface border-line'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            {editingId !== null ? `Редактировать — ID ${editingId}` : 'Добавить услугу'}
          </h2>
          {editingId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Название</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="Обработка кривых деталей (полировка торца)"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Тип расчёта</label>
            <select
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value as B2BService['type'] })}>
              <option value="percent">% от цены изделия</option>
              <option value="per_m2">₽ × м² изделия</option>
              <option value="fixed">₽ фиксированно за шт</option>
              <option value="calculated">Расчёт от трудозатрат</option>
              <option value="film">Приклейка плёнки (из справочника)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Единица отображения</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={form.unit_label}
              onChange={e => setForm({ ...form, unit_label: e.target.value })}
              placeholder="₽/шт"
            />
          </div>

          {/* Описание для film-типа */}
          {form.type === 'film' && (
            <div className="col-span-2 px-4 py-3 bg-sky-50 border border-sky-200 rounded-lg text-[12px] text-sky-700">
              Цена продажи и себестоимость берутся из выбранной плёнки в справочнике ниже.
              Добавьте плёнки в раздел «Справочник плёнок» — менеджер выберет нужную в калькуляторе.
            </div>
          )}

          {/* Поля для типов не-calculated и не-film */}
          {form.type !== 'calculated' && form.type !== 'film' && (
            <>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">
                  {form.type === 'percent' ? 'Процент (%)' : 'Сумма (₽)'}
                </label>
                <input type="number" min="0"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
                  value={form.value}
                  onChange={e => setForm({ ...form, value: Number(e.target.value) })}
                  placeholder={form.type === 'percent' ? '30' : '1200'}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">
                  Себестоимость (₽{form.type === 'per_m2' ? '/м²' : '/шт'})
                </label>
                <input type="number" min="0"
                  className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
                  value={form.cost_price}
                  onChange={e => setForm({ ...form, cost_price: Number(e.target.value) })}
                  placeholder="0"
                />
              </div>
            </>
          )}
        </div>

        {/* ── Блок для calculated-услуги ── */}
        {form.type === 'calculated' && (
          <div className="border border-line rounded-xl p-4 mb-4 bg-surface space-y-4">
            <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Параметры трудозатрат</p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Время (мин)</label>
                <input type="number" min="0" step="0.5"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.time_minutes}
                  onChange={e => setForm({ ...form, time_minutes: Number(e.target.value) })}
                  placeholder="20"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Амортизация обор. (₽)</label>
                <input type="number" min="0" step="1"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.equipment_depr_rub}
                  onChange={e => setForm({ ...form, equipment_depr_rub: Number(e.target.value) })}
                  placeholder="30"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Расходники (₽)</label>
                <input type="number" min="0" step="1"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.consumables_cost_rub}
                  onChange={e => setForm({ ...form, consumables_cost_rub: Number(e.target.value) })}
                  placeholder="80"
                />
              </div>

              {/* ── Помощник расчёта амортизации и расходников ── */}
              <div className="col-span-3 bg-[#f5f5ff] border border-[#e0e0f5] rounded-lg p-3 mt-1">
                <p className="text-[10px] font-semibold text-[#6b6b9a] uppercase tracking-wider mb-2">Помощник расчёта → заполнит поля выше автоматически</p>
                <div className="grid grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Стоимость станка (₽)</label>
                    <input type="number" min="0"
                      className="w-full bg-surface border border-[#ddddf0] rounded-md px-2 py-1.5 text-[12px] font-mono outline-none focus:border-[#6b6bcc]"
                      value={equipCost}
                      onChange={e => setEquipCost(e.target.value)}
                      placeholder="800 000"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Срок службы (лет)</label>
                    <input type="number" min="1" max="20"
                      className="w-full bg-surface border border-[#ddddf0] rounded-md px-2 py-1.5 text-[12px] font-mono outline-none focus:border-[#6b6bcc]"
                      value={equipLife}
                      onChange={e => setEquipLife(e.target.value)}
                      placeholder="5"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Расходник (₽/шт)</label>
                    <input type="number" min="0"
                      className="w-full bg-surface border border-[#ddddf0] rounded-md px-2 py-1.5 text-[12px] font-mono outline-none focus:border-[#6b6bcc]"
                      value={consUnit}
                      onChange={e => setConsUnit(e.target.value)}
                      placeholder="500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-muted mb-1">Ресурс расходника (опер.)</label>
                    <input type="number" min="1"
                      className="w-full bg-surface border border-[#ddddf0] rounded-md px-2 py-1.5 text-[12px] font-mono outline-none focus:border-[#6b6bcc]"
                      value={consLife}
                      onChange={e => setConsLife(e.target.value)}
                      placeholder="20"
                    />
                  </div>
                </div>
                {(() => {
                  const hoursPerYear = ps.working_days_per_month * 12 * ps.working_hours_per_day
                  const totalHours   = Number(equipLife || 5) * hoursPerYear
                  const deprPerHour  = Number(equipCost) > 0 ? Number(equipCost) / totalHours : 0
                  const deprPerOp    = Math.round(deprPerHour * (form.time_minutes / 60))
                  const consPerOp    = Number(consUnit) > 0 && Number(consLife) > 0
                    ? Math.round(Number(consUnit) / Number(consLife))
                    : 0
                  return (
                    <div className="flex items-center justify-between mt-2">
                      <div className="text-[11px] text-[#6b6b9a] space-x-4">
                        {Number(equipCost) > 0 && (
                          <span>Амортизация: <strong>{deprPerOp} ₽/операцию</strong> ({(deprPerHour).toFixed(2)} ₽/час)</span>
                        )}
                        {consPerOp > 0 && (
                          <span>Расходники: <strong>{consPerOp} ₽/операцию</strong></span>
                        )}
                        {Number(equipCost) === 0 && consPerOp === 0 && (
                          <span className="text-[#b4b4c8]">Заполни поля выше — посчитаю автоматически</span>
                        )}
                      </div>
                      {(Number(equipCost) > 0 || consPerOp > 0) && (
                        <button
                          type="button"
                          onClick={() => {
                            const h = ps.working_days_per_month * 12 * ps.working_hours_per_day
                            const t = Number(equipLife || 5) * h
                            const dph = Number(equipCost) > 0 ? Number(equipCost) / t : 0
                            const dpo = Math.round(dph * (form.time_minutes / 60))
                            const cpo = Number(consUnit) > 0 && Number(consLife) > 0
                              ? Math.round(Number(consUnit) / Number(consLife))
                              : form.consumables_cost_rub
                            setForm(prev => ({
                              ...prev,
                              equipment_depr_rub:  Number(equipCost) > 0 ? dpo : prev.equipment_depr_rub,
                              consumables_cost_rub: Number(consUnit) > 0 && Number(consLife) > 0 ? cpo : prev.consumables_cost_rub,
                            }))
                          }}
                          className="text-[11px] font-semibold text-white bg-[#6b6bcc] hover:bg-[#5555bb] px-3 py-1 rounded-md transition-colors">
                          ↑ Применить
                        </button>
                      )}
                    </div>
                  )
                })()}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Накладные % (пусто = по умолчанию)</label>
                <input type="number" min="0" max="100"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.overhead_override_pct}
                  onChange={e => setForm({ ...form, overhead_override_pct: e.target.value })}
                  placeholder={`${ps.overhead_percent} (по умолч.)`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Наценка % (пусто = по умолчанию)</label>
                <input type="number" min="0" max="100"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.margin_override_pct}
                  onChange={e => setForm({ ...form, margin_override_pct: e.target.value })}
                  placeholder={`${ps.default_margin_percent} (по умолч.)`}
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-wider mb-1">Ручная цена продажи (₽)</label>
                <input type="number" min="0"
                  className="w-full bg-[#f9f9f8] border border-line rounded-lg px-2 py-1.5 text-[13px] font-mono outline-none focus:border-ink"
                  value={form.sale_price_override}
                  onChange={e => setForm({ ...form, sale_price_override: e.target.value })}
                  placeholder="Оставьте пустым для автоматического"
                />
              </div>
            </div>

            {/* Превью расчёта */}
            {formCostPreview && (
              <div className="bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg px-4 py-3 text-[12px] space-y-1">
                <p className="font-semibold text-[#166534] mb-2">Расчёт себестоимости{form.size_tiers.length > 0 ? ' (1-й диапазон)' : ''}:</p>
                <div className="grid grid-cols-2 gap-x-6 text-[#374151]">
                  <span>Труд ({form.time_minutes} мин × {minuteRate.toFixed(2)} ₽)</span>
                  <span className="font-mono text-right">{fmtRub(formCostPreview.labor_cost)}</span>
                  <span>Амортизация оборудования</span>
                  <span className="font-mono text-right">{fmtRub(formCostPreview.equipment_cost)}</span>
                  <span>Расходники</span>
                  <span className="font-mono text-right">{fmtRub(formCostPreview.consumables_cost)}</span>
                  <span>Накладные расходы ({form.overhead_override_pct || ps.overhead_percent}%)</span>
                  <span className="font-mono text-right">{fmtRub(formCostPreview.overhead_cost)}</span>
                  <span className="font-semibold border-t border-[#bbf7d0] pt-1">Себестоимость</span>
                  <span className="font-mono font-semibold text-right border-t border-[#bbf7d0] pt-1">{fmtRub(formCostPreview.cost_price)}</span>
                  <span className="font-semibold text-[#166534]">Цена продажи ({form.sale_price_override ? 'ручная' : `наценка ${form.margin_override_pct || ps.default_margin_percent}%`})</span>
                  <span className="font-mono font-semibold text-right text-[#166534]">{fmtRub(formCostPreview.sale_price)}</span>
                </div>
              </div>
            )}

            {/* Диапазоны по размеру */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">Диапазоны по размеру</p>
                <button onClick={addTier}
                  className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-0.5 rounded transition-colors">
                  + Добавить диапазон
                </button>
              </div>
              {form.size_tiers.length === 0 ? (
                <p className="text-[12px] text-muted italic">Без диапазонов — базовые поля выше применяются ко всем размерам</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_100px_80px_100px_28px] gap-2 text-[10px] font-semibold text-muted uppercase tracking-wider px-1">
                    <span>Название диапазона</span>
                    <span>Макс. размер (мм)</span>
                    <span>Время (мин)</span>
                    <span>Расходники (₽)</span>
                    <span></span>
                  </div>
                  {form.size_tiers.map((tier, idx) => {
                    const tierPreview = calcServiceCost(
                      { ...form, size_tiers: form.size_tiers,
                        overhead_override_pct: form.overhead_override_pct !== '' ? Number(form.overhead_override_pct) : null,
                        margin_override_pct:   form.margin_override_pct !== '' ? Number(form.margin_override_pct) : null,
                        sale_price_override:   form.sale_price_override !== '' ? Number(form.sale_price_override) : null,
                      }, ps, idx
                    )
                    return (
                      <div key={idx} className="grid grid-cols-[1fr_100px_80px_100px_28px] gap-2 items-center">
                        <input
                          className="bg-surface border border-line rounded-md px-2 py-1 text-[12px] outline-none focus:border-ink"
                          value={tier.label}
                          onChange={e => updateTier(idx, 'label', e.target.value)}
                          placeholder="500–1000 мм"
                        />
                        <input type="number" min="0"
                          className="bg-surface border border-line rounded-md px-2 py-1 text-[12px] font-mono outline-none focus:border-ink"
                          value={tier.max_mm ?? ''}
                          onChange={e => updateTier(idx, 'max_mm', e.target.value)}
                          placeholder="∞"
                        />
                        <input type="number" min="0" step="0.5"
                          className="bg-surface border border-line rounded-md px-2 py-1 text-[12px] font-mono outline-none focus:border-ink"
                          value={tier.time_minutes}
                          onChange={e => updateTier(idx, 'time_minutes', e.target.value)}
                        />
                        <div className="relative">
                          <input type="number" min="0"
                            className="w-full bg-surface border border-line rounded-md px-2 py-1 text-[12px] font-mono outline-none focus:border-ink"
                            value={tier.consumables_cost_rub}
                            onChange={e => updateTier(idx, 'consumables_cost_rub', e.target.value)}
                          />
                          <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-muted pointer-events-none">
                            → {fmtRub(tierPreview.sale_price)}
                          </span>
                        </div>
                        <button onClick={() => removeTier(idx)}
                          className="text-faint hover:text-red-500 transition-colors text-sm font-semibold leading-none">
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Порядок сортировки</label>
            <input type="number" min="0"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={form.sort_order}
              onChange={e => setForm({ ...form, sort_order: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Описание (необязательно)</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              placeholder="Пояснение для менеджера"
            />
          </div>
        </div>

        {error && <p className="mt-2 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSave} disabled={saving || !form.name.trim()}
            className="bg-ink text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {saving ? 'Сохранение...' : editingId !== null ? 'Сохранить' : 'Добавить'}
          </button>
          {editingId !== null && (
            <button onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setError(null) }}
              className="bg-line-soft text-ink text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      {/* ── Справочник плёнок ── */}
      <div className="mt-10 mb-2">
        <h2 className="text-[16px] font-semibold text-ink tracking-tight">Справочник плёнок</h2>
        <p className="text-[13px] text-muted mt-0.5">Плёнки для услуги «Приклейка плёнки» — себестоимость и продажная цена за м²</p>
      </div>

      <div className={`rounded-xl border p-5 mb-6 transition-all ${editingFilmId !== null ? 'bg-blue-50 border-blue-200' : 'bg-surface border-line'}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
            {editingFilmId !== null ? `Редактировать плёнку — ID ${editingFilmId}` : 'Добавить плёнку'}
          </h3>
          {editingFilmId !== null && (
            <span className="text-[11px] font-semibold text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">Режим редактирования</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="col-span-2">
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Название плёнки</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={filmForm.name}
              onChange={e => setFilmForm({ ...filmForm, name: e.target.value })}
              placeholder="Плёнка матовая белая"
            />
          </div>

          {/* Плёнка (материал) */}
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2 mt-1">Плёнка (материал)</p>
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Себестоимость ₽/м²</label>
            <input type="number" min="0" step="0.01"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={filmForm.cost_price_per_m2}
              onChange={e => setFilmForm({ ...filmForm, cost_price_per_m2: Number(e.target.value) })}
              placeholder="350"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Цена продажи ₽/м²</label>
            <input type="number" min="0" step="0.01"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={filmForm.sale_price_per_m2}
              onChange={e => setFilmForm({ ...filmForm, sale_price_per_m2: Number(e.target.value) })}
              placeholder="600"
            />
          </div>

          {/* Работа (приклейка) */}
          <div className="col-span-2">
            <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2 mt-1">Работа (приклейка)</p>
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Себестоимость ₽/м²</label>
            <input type="number" min="0" step="0.01"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={filmForm.work_cost_per_m2}
              onChange={e => setFilmForm({ ...filmForm, work_cost_per_m2: Number(e.target.value) })}
              placeholder="200"
            />
          </div>
          <div>
            <label className="block text-[10px] text-muted mb-1">Цена продажи ₽/м²</label>
            <input type="number" min="0" step="0.01"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={filmForm.work_sale_per_m2}
              onChange={e => setFilmForm({ ...filmForm, work_sale_per_m2: Number(e.target.value) })}
              placeholder="400"
            />
          </div>

          {/* Итого */}
          {(filmForm.sale_price_per_m2 > 0 || filmForm.work_sale_per_m2 > 0) && (
            <div className="col-span-2 flex items-center justify-between px-4 py-2.5 bg-[#f0fdf4] border border-[#bbf7d0] rounded-lg">
              <span className="text-[12px] text-[#166534] font-semibold">Итого клиенту:</span>
              <span className="text-[14px] font-semibold font-mono text-[#166534]">
                {(filmForm.sale_price_per_m2 + filmForm.work_sale_per_m2).toLocaleString('ru-RU')} ₽/м²
              </span>
              <span className="text-[11px] text-muted">
                ({filmForm.sale_price_per_m2.toLocaleString('ru-RU')} плёнка + {filmForm.work_sale_per_m2.toLocaleString('ru-RU')} работа)
              </span>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Описание (необязательно)</label>
            <input
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] text-ink outline-none focus:border-ink"
              value={filmForm.description}
              onChange={e => setFilmForm({ ...filmForm, description: e.target.value })}
              placeholder="Пояснение для менеджера"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1">Порядок сортировки</label>
            <input type="number" min="0"
              className="w-full bg-surface border border-line rounded-lg px-3 py-2 text-[14px] font-mono text-ink outline-none focus:border-ink"
              value={filmForm.sort_order}
              onChange={e => setFilmForm({ ...filmForm, sort_order: Number(e.target.value) })}
            />
          </div>
        </div>
        {filmError && <p className="mt-2 text-[13px] text-red-600 bg-red-50 px-3 py-2 rounded-lg">{filmError}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={handleSaveFilm} disabled={filmSaving || !filmForm.name.trim()}
            className="bg-ink text-white text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
            {filmSaving ? 'Сохранение...' : editingFilmId !== null ? 'Сохранить' : 'Добавить плёнку'}
          </button>
          {editingFilmId !== null && (
            <button onClick={() => { setEditingFilmId(null); setFilmForm(EMPTY_FILM_FORM); setFilmError(null) }}
              className="bg-line-soft text-ink text-[13px] font-medium px-4 py-2 rounded-lg hover:bg-[#e8e8e4] transition-colors">
              Отмена
            </button>
          )}
        </div>
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden mb-10">
        {films.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">Нет плёнок — добавьте первую</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Название</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Плёнка себ.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Плёнка прод.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Работа себ.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Работа прод.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-emerald-700 uppercase tracking-widest w-28">Итого клиенту</th>
                <th className="w-36 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {films.map(f => (
                <tr key={f.id}
                  className={`border-b border-canvas last:border-0 transition-colors ${editingFilmId === f.id ? 'bg-blue-50' : 'hover:bg-subtle'} ${!f.active ? 'opacity-35' : ''}`}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{f.name}</p>
                    {f.description && <p className="text-[12px] text-muted mt-0.5">{f.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-soft">
                    {f.cost_price_per_m2.toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-ink">
                    {f.sale_price_per_m2.toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-soft">
                    {(f.work_cost_per_m2 ?? 0).toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[12px] text-ink">
                    {(f.work_sale_per_m2 ?? 0).toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold text-[12px] text-emerald-700">
                    {(f.sale_price_per_m2 + (f.work_sale_per_m2 ?? 0)).toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3 justify-end">
                      <button onClick={() => startEditFilm(f)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                      <button onClick={() => toggleFilmActive(f.id, f.active)} className="text-[12px] text-muted hover:text-ink-soft transition-colors">
                        {f.active ? 'Скрыть' : 'Показать'}
                      </button>
                      <button onClick={() => deleteFilm(f.id, f.name)} className="text-[12px] text-red-400 hover:text-red-600 transition-colors">Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Список услуг ── */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-[13px] text-muted">Загрузка...</div>
        ) : services.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-muted">Нет услуг — добавьте первую</div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line-soft">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Услуга</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest">Тип</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Себест.</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted uppercase tracking-widest w-28">Цена прод.</th>
                <th className="w-36 px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {services.map(s => {
                const isCalc = s.type === 'calculated'
                const liveCost = isCalc
                  ? calcServiceCost({
                      time_minutes: s.time_minutes ?? 0,
                      equipment_depr_rub: s.equipment_depr_rub ?? 0,
                      consumables_cost_rub: s.consumables_cost_rub ?? 0,
                      overhead_override_pct: s.overhead_override_pct,
                      margin_override_pct: s.margin_override_pct,
                      sale_price_override: s.sale_price_override,
                      size_tiers: s.size_tiers,
                    }, ps)
                  : null
                return (
                  <tr key={s.id}
                    className={`border-b border-canvas last:border-0 transition-colors ${editingId === s.id ? 'bg-blue-50' : 'hover:bg-subtle'} ${!s.active ? 'opacity-35' : ''}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{s.name}</p>
                      {s.description && <p className="text-[12px] text-muted mt-0.5">{s.description}</p>}
                      {isCalc && s.size_tiers && s.size_tiers.length > 0 && (
                        <p className="text-[10px] text-blue-500 mt-0.5">{s.size_tiers.length} диапазона по размеру</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${isCalc ? 'bg-purple-50 text-purple-700' : 'bg-line-soft text-ink-soft'}`}>
                        {TYPE_LABELS[s.type]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-soft">
                      {isCalc
                        ? <span className="text-purple-700">{fmtRub(liveCost!.cost_price)}</span>
                        : (s.cost_price ?? 0) > 0
                          ? `${(s.cost_price ?? 0).toLocaleString('ru-RU')} ₽`
                          : <span className="text-faint">—</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-[12px] text-ink">
                      {isCalc
                        ? <span className="text-purple-700 font-semibold">{fmtRub(liveCost!.sale_price)}</span>
                        : s.type === 'percent'
                          ? `${s.value}%`
                          : `${s.value.toLocaleString('ru-RU')} ₽`
                      }
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 justify-end">
                        <button onClick={() => startEdit(s)} className="text-[12px] font-semibold text-blue-600 hover:text-blue-800 transition-colors">Изменить</button>
                        <button onClick={() => toggleActive(s.id, s.active)} className="text-[12px] text-muted hover:text-ink-soft transition-colors">
                          {s.active ? 'Скрыть' : 'Показать'}
                        </button>
                        <button onClick={() => deleteService(s.id, s.name)} className="text-[12px] text-red-400 hover:text-red-600 transition-colors">Удалить</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
