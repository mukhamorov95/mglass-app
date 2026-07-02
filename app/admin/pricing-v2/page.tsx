'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

type Config = {
  production_tax_percent:    number
  production_margin_percent: number
  b2c_tax_percent:           number
  b2c_margin_percent:        number
  factory_overhead_percent:  number
  scrap_reserve_percent:     number
  packaging_cost_per_m2:     number
}

const DEFAULTS: Config = {
  production_tax_percent:    12,
  production_margin_percent: 40,
  b2c_tax_percent:           12,
  b2c_margin_percent:        40,
  factory_overhead_percent:  20,
  scrap_reserve_percent:     5,
  packaging_cost_per_m2:     120,
}

export default function PricingV2Page() {
  const [form, setForm]       = useState<Config>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => { load().catch(() => setLoading(false)) }, [])

  const SELECT_COLUMNS =
    'product_category, production_tax_percent, production_margin_percent, b2c_tax_percent, b2c_margin_percent, factory_overhead_percent, scrap_reserve_percent, packaging_cost_per_m2, active'

  function applyRowToForm(row: Record<string, number | boolean | string | null>) {
    setForm({
      production_tax_percent:    Number(row.production_tax_percent    ?? DEFAULTS.production_tax_percent),
      production_margin_percent: Number(row.production_margin_percent ?? DEFAULTS.production_margin_percent),
      b2c_tax_percent:           Number(row.b2c_tax_percent           ?? DEFAULTS.b2c_tax_percent),
      b2c_margin_percent:        Number(row.b2c_margin_percent        ?? DEFAULTS.b2c_margin_percent),
      factory_overhead_percent:  Number(row.factory_overhead_percent  ?? DEFAULTS.factory_overhead_percent),
      scrap_reserve_percent:     Number(row.scrap_reserve_percent     ?? DEFAULTS.scrap_reserve_percent),
      packaging_cost_per_m2:     Number(row.packaging_cost_per_m2     ?? DEFAULTS.packaging_cost_per_m2),
    })
  }

  async function load() {
    setLoading(true)
    setError(null)
    const { data, error } = await createClient()
      .from('pricing_model_config_v2')
      .select(SELECT_COLUMNS)
      .eq('product_category', 'mirror')
      .maybeSingle()
    if (error) setError(error.message)
    else if (data) applyRowToForm(data as Record<string, number | boolean | string | null>)
    setLoading(false)
  }

  function validate(c: Config): string | null {
    if (c.production_tax_percent < 0 || c.production_tax_percent >= 100)       return 'Налог производства вне диапазона [0, 100)'
    if (c.production_margin_percent < 0 || c.production_margin_percent >= 100) return 'Маржа производства вне диапазона [0, 100)'
    if (c.production_tax_percent + c.production_margin_percent >= 100)         return 'Сумма налог+маржа производства должна быть < 100'
    if (c.b2c_tax_percent < 0 || c.b2c_tax_percent >= 100)                     return 'Налог B2C вне диапазона [0, 100)'
    if (c.b2c_margin_percent < 0 || c.b2c_margin_percent >= 100)               return 'Маржа B2C вне диапазона [0, 100)'
    if (c.b2c_tax_percent + c.b2c_margin_percent >= 100)                       return 'Сумма налог+маржа B2C должна быть < 100'
    if (c.factory_overhead_percent < 0 || c.factory_overhead_percent >= 100)   return 'Накладные производства вне диапазона [0, 100)'
    if (c.scrap_reserve_percent < 0 || c.scrap_reserve_percent >= 100)         return 'Резерв брака вне диапазона [0, 100)'
    if (c.packaging_cost_per_m2 < 0)                                           return 'Упаковка не может быть отрицательной'
    return null
  }

  async function save() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const v = validate(form)
    if (v) { setError(v); setSaving(false); return }
    // Upsert (а не голый update) — гарантирует, что если строки с
    // product_category='mirror' ещё нет в окружении (миграция-сид не применена),
    // она будет создана. .select().single() заставляет Supabase вернуть строку,
    // которую действительно записал — без этого UPDATE без матча возвращал бы
    // { data: null, error: null }, и UI показывал бы fake "✓ Сохранено".
    const payload = {
      product_category:          'mirror',
      production_tax_percent:    form.production_tax_percent,
      production_margin_percent: form.production_margin_percent,
      b2c_tax_percent:           form.b2c_tax_percent,
      b2c_margin_percent:        form.b2c_margin_percent,
      factory_overhead_percent:  form.factory_overhead_percent,
      scrap_reserve_percent:     form.scrap_reserve_percent,
      packaging_cost_per_m2:     form.packaging_cost_per_m2,
      active:                    true,
      updated_at:                new Date().toISOString(),
    }
    const { data, error } = await createClient()
      .from('pricing_model_config_v2')
      .upsert(payload, { onConflict: 'product_category' })
      .select(SELECT_COLUMNS)
      .single()
    if (error) {
      setError(error.message)
      setSaving(false)
      return
    }
    if (!data) {
      setError('Настройки не были сохранены: Supabase не вернул строку (возможно RLS отфильтровал запрос).')
      setSaving(false)
      return
    }
    applyRowToForm(data as Record<string, number | boolean | string | null>)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    setSaving(false)
  }

  function numField(label: string, desc: string, unit: string, key: keyof Config, step = 1) {
    return (
      <div className="flex items-start justify-between py-3 border-b border-[#f0f0ec] last:border-0 gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-[#111110]">{label}</div>
          <div className="text-[12px] text-[#9a9a95] mt-0.5">{desc}</div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            type="number"
            value={form[key]}
            step={step}
            min={0}
            onChange={e => setForm(f => ({ ...f, [key]: Number(e.target.value) }))}
            className="w-24 border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] text-right focus:outline-none focus:border-blue-400"
          />
          <span className="text-[13px] text-[#9a9a95] w-12">{unit}</span>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="min-h-screen bg-[#fafaf9] flex items-center justify-center text-[#9a9a95]">Загрузка...</div>
  }

  const productionDenom = 1 - form.production_tax_percent / 100 - form.production_margin_percent / 100
  const b2cDenom        = 1 - form.b2c_tax_percent        / 100 - form.b2c_margin_percent        / 100

  return (
    <div className="min-h-screen bg-[#fafaf9] py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110]">Финмодель V2 · Зеркала</h1>
            <p className="text-[13px] text-[#9a9a95] mt-1">
              Двухступенчатая модель: Factory Cost → B2B Price → B2C Client Price.
              Применяется только в preview-блоке калькулятора. Live КП/заказы пока сохраняются по live-цене.
            </p>
          </div>
          <Link
            href="/calculator/mirror"
            className="text-[12px] text-blue-600 hover:underline whitespace-nowrap"
          >
            ← К калькулятору
          </Link>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] px-5">
          <div className="py-2 border-b border-[#f0f0ec] mb-1">
            <span className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Stage 1 · Производство (B2B)</span>
          </div>
          <p className="text-[12px] text-[#6b6b66] py-2 leading-snug">
            Производство/B2B — формирует цену продажи партнёру.
          </p>
          {numField('Налог производства',  'Налог на B2B-выручку',                              '%',  'production_tax_percent',    1)}
          {numField('Маржа производства',  'Прибыль производства в B2B-цене',                   '%',  'production_margin_percent', 1)}
          <div className="py-2.5 text-[11px] text-[#9a9a95] font-mono leading-snug">
            Знаменатель: 1 − {form.production_tax_percent}% − {form.production_margin_percent}% = {productionDenom.toFixed(2)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] px-5">
          <div className="py-2 border-b border-[#f0f0ec] mb-1">
            <span className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Stage 2 · B2C (клиент)</span>
          </div>
          <p className="text-[12px] text-[#6b6b66] py-2 leading-snug">
            B2C — формирует цену конечному клиенту от B2B-закупки.
          </p>
          {numField('Налог B2C',           'Налог на розничную выручку',                        '%',  'b2c_tax_percent',           1)}
          {numField('Маржа B2C',           'Прибыль B2C в розничной цене',                      '%',  'b2c_margin_percent',        1)}
          <div className="py-2.5 text-[11px] text-[#9a9a95] font-mono leading-snug">
            Знаменатель: 1 − {form.b2c_tax_percent}% − {form.b2c_margin_percent}% = {b2cDenom.toFixed(2)}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-[#e4e4e0] px-5">
          <div className="py-2 border-b border-[#f0f0ec] mb-1">
            <span className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wide">Себестоимость производства</span>
          </div>
          {numField('Накладные производства', 'Электричество, аренда цеха, прочее — % к материалам', '%',  'factory_overhead_percent', 1)}
          {numField('Резерв брака/отхода',    'Запас на брак и обрезки — % к материалам',             '%',  'scrap_reserve_percent',    1)}
          {numField('Упаковка',                'Стоимость упаковки на 1 м² billingArea',               '₽/м²','packaging_cost_per_m2',    10)}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="bg-[#111110] hover:bg-[#2a2a28] text-white text-[13px] font-semibold px-5 py-2 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? 'Сохранение...' : 'Сохранить настройки'}
          </button>
          {saved && <span className="text-[12px] text-emerald-600 font-semibold">✓ Сохранено</span>}
          <button
            onClick={load}
            disabled={saving}
            className="text-[12px] text-[#9a9a95] hover:text-[#111110] underline"
          >
            Сбросить
          </button>
        </div>

        <div className="bg-[#f5f5f3] border border-[#e4e4e0] rounded-xl px-4 py-3 text-[12px] text-[#6b6b66] leading-snug">
          <p className="font-semibold text-[#111110] mb-1">Как это считается</p>
          <p className="font-mono text-[11px] mb-1">B2B Price = Factory Cost / (1 − налог% − маржа%)</p>
          <p className="font-mono text-[11px]">B2C Price = B2B Price / (1 − налог% − маржа%)</p>
          <p className="mt-2">
            Factory Cost — это сумма материалов + упаковка + резерв брака% от материалов + накладные% от материалов.
          </p>
        </div>

      </div>
    </div>
  )
}
