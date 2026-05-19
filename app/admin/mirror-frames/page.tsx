'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { MirrorFrame, FRAME_TYPES, FRAME_COLORS, calcFrameCost } from '@/lib/types'
import { ProductionSettings, DEFAULT_PRODUCTION_SETTINGS } from '@/lib/calcServiceCost'

type FrameForm = {
  article: string
  name: string
  supplier: string
  supplier_url: string
  frame_type: string
  color: string
  profile_size: string
  whip_length_m: string
  cost_per_m: string
  sale_per_m: string
  waste_factor: string
  cut_minutes: string
  assemble_minutes: string
  pack_minutes: string
  assemble_cost_rub: string
  assemble_sale_rub: string
  notes: string
  active: boolean
  sort_order: string
}

const EMPTY: FrameForm = {
  article: '', name: '', supplier: '', supplier_url: '',
  frame_type: 'classic', color: 'black', profile_size: '',
  whip_length_m: '6', cost_per_m: '', sale_per_m: '',
  waste_factor: '1.10',
  cut_minutes: '10', assemble_minutes: '25', pack_minutes: '5',
  assemble_cost_rub: '', assemble_sale_rub: '',
  notes: '', active: true, sort_order: '0',
}

function fmt(n: number) { return n.toLocaleString('ru-RU') }

export default function MirrorFramesPage() {
  const [frames, setFrames]       = useState<MirrorFrame[]>([])
  const [loading, setLoading]     = useState(true)
  const [form, setForm]           = useState<FrameForm>(EMPTY)
  const [editId, setEditId]       = useState<number | null>(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [previewW, setPreviewW]   = useState('1000')
  const [previewH, setPreviewH]   = useState('800')
  const [prodSettings, setProdSettings] = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [priceMode, setPriceMode] = useState<'per_m' | 'per_whip'>('per_m')

  async function load() {
    const supabase = createClient()
    const [{ data }, { data: psData }] = await Promise.all([
      supabase.from('mirror_frames').select('*').order('sort_order').order('name'),
      supabase.from('production_settings').select('*').eq('id', 1).maybeSingle(),
    ])
    setFrames((data ?? []) as MirrorFrame[])
    if (psData) setProdSettings(psData as ProductionSettings)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function startEdit(f: MirrorFrame) {
    setEditId(f.id)
    setForm({
      article: f.article ?? '', name: f.name, supplier: f.supplier ?? '',
      supplier_url: f.supplier_url ?? '', frame_type: f.frame_type, color: f.color,
      profile_size: f.profile_size ?? '', whip_length_m: String(f.whip_length_m),
      cost_per_m: String(f.cost_per_m), sale_per_m: String(f.sale_per_m),
      waste_factor: String(f.waste_factor),
      cut_minutes: String(f.cut_minutes), assemble_minutes: String(f.assemble_minutes),
      pack_minutes: String(f.pack_minutes),
      assemble_cost_rub: f.assemble_cost_rub != null ? String(f.assemble_cost_rub) : '',
      assemble_sale_rub: f.assemble_sale_rub != null ? String(f.assemble_sale_rub) : '',
      notes: f.notes ?? '', active: f.active, sort_order: String(f.sort_order),
    })
    setPriceMode('per_m')
    setError(null)
  }

  function resetForm() { setEditId(null); setForm(EMPTY); setPriceMode('per_m'); setError(null) }

  async function handleSave() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    if (!form.cost_per_m || !form.sale_per_m) { setError('Укажите цены'); return }
    setSaving(true); setError(null)
    const supabase = createClient()
    const whipLen = parseFloat(form.whip_length_m) || 6
    const rawCost = parseFloat(form.cost_per_m) || 0
    const rawSale = parseFloat(form.sale_per_m) || 0
    const costPerM = priceMode === 'per_whip' ? rawCost / whipLen : rawCost
    const salePerM = priceMode === 'per_whip' ? rawSale / whipLen : rawSale
    const row = {
      article: form.article || null, name: form.name.trim(),
      supplier: form.supplier || null, supplier_url: form.supplier_url || null,
      frame_type: form.frame_type, color: form.color,
      profile_size: form.profile_size || null,
      whip_length_m: whipLen,
      cost_per_m: costPerM,
      sale_per_m: salePerM,
      waste_factor: parseFloat(form.waste_factor) || 1.10,
      cut_minutes: parseInt(form.cut_minutes) || 10,
      assemble_minutes: parseInt(form.assemble_minutes) || 25,
      pack_minutes: parseInt(form.pack_minutes) || 5,
      assemble_cost_rub: form.assemble_cost_rub ? parseFloat(form.assemble_cost_rub) : null,
      assemble_sale_rub: form.assemble_sale_rub ? parseFloat(form.assemble_sale_rub) : null,
      notes: form.notes || null, active: form.active,
      sort_order: parseInt(form.sort_order) || 0,
    }
    const { error: err } = editId
      ? await supabase.from('mirror_frames').update(row).eq('id', editId)
      : await supabase.from('mirror_frames').insert(row)
    if (err) { setError(err.message); setSaving(false); return }
    await load(); resetForm(); setSaving(false)
  }

  async function toggleActive(f: MirrorFrame) {
    const supabase = createClient()
    await supabase.from('mirror_frames').update({ active: !f.active }).eq('id', f.id)
    setFrames(prev => prev.map(x => x.id === f.id ? { ...x, active: !x.active } : x))
  }

  async function deleteFrame(id: number) {
    if (!confirm('Удалить рамку?')) return
    const supabase = createClient()
    await supabase.from('mirror_frames').delete().eq('id', id)
    setFrames(prev => prev.filter(f => f.id !== id))
  }

  // Live preview for the current form
  const _whipLen    = parseFloat(form.whip_length_m) || 6
  const _rawCost    = parseFloat(form.cost_per_m) || 0
  const _rawSale    = parseFloat(form.sale_per_m) || 0
  const _costPerM   = priceMode === 'per_whip' ? _rawCost / _whipLen : _rawCost
  const _salePerM   = priceMode === 'per_whip' ? _rawSale / _whipLen : _rawSale

  const previewFrame: MirrorFrame | null = form.name && form.cost_per_m && form.sale_per_m ? {
    id: 0, article: null, name: form.name, supplier: null, supplier_url: null,
    frame_type: form.frame_type, color: form.color, profile_size: form.profile_size || null,
    whip_length_m: _whipLen,
    cost_per_m: _costPerM,
    sale_per_m: _salePerM,
    waste_factor: parseFloat(form.waste_factor) || 1.10,
    cut_minutes: parseInt(form.cut_minutes) || 10,
    assemble_minutes: parseInt(form.assemble_minutes) || 25,
    pack_minutes: parseInt(form.pack_minutes) || 5,
    assemble_cost_rub: form.assemble_cost_rub ? parseFloat(form.assemble_cost_rub) : null,
    assemble_sale_rub: form.assemble_sale_rub ? parseFloat(form.assemble_sale_rub) : null,
    image_url: null, active: form.active, sort_order: 0, notes: null, created_at: '',
  } : null

  const minuteRate = prodSettings.worker_monthly_salary /
    (prodSettings.working_days_per_month * prodSettings.working_hours_per_day * 60)
  const saleMinuteRate = minuteRate *
    (1 + prodSettings.overhead_percent / 100) *
    (1 + prodSettings.default_margin_percent / 100)
  const preview = previewFrame ? calcFrameCost(previewFrame, parseInt(previewW) || 1000, parseInt(previewH) || 800, minuteRate, saleMinuteRate) : null

  const inp = 'w-full border border-[#e4e4e0] rounded-md px-2 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-400'
  const lbl = 'text-[10px] text-[#9a9a95] mb-1 block'

  // Auto-calculated assembly cost from current form values
  const formTotalMinutes = (parseInt(form.cut_minutes) || 0) + (parseInt(form.assemble_minutes) || 0) + (parseInt(form.pack_minutes) || 0)
  const autoAssemblyCost = form.assemble_cost_rub ? parseFloat(form.assemble_cost_rub) : Math.round(formTotalMinutes * minuteRate)
  const autoAssemblySale = form.assemble_sale_rub ? parseFloat(form.assemble_sale_rub) : Math.round(formTotalMinutes * saleMinuteRate)
  const [showOverride, setShowOverride] = useState(false)

  if (loading) return <div className="flex items-center justify-center h-64 text-[#9a9a95] text-sm">Загрузка...</div>

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-bold text-[#111110]">Рамки зеркал</h1>
          <p className="text-xs text-[#9a9a95] mt-0.5">Справочник профилей для декоративных рамок</p>
        </div>
        {editId && (
          <button onClick={resetForm} className="text-xs text-[#6b6b66] hover:text-[#111110] border border-[#e4e4e0] px-3 py-1.5 rounded-md">
            ← Новая рамка
          </button>
        )}
      </div>

      {/* ── Guide banner ── */}
      <div className="mb-4 bg-blue-50 border border-blue-100 rounded-lg p-3.5 text-[11px] text-blue-800 space-y-1.5">
        <p className="font-semibold text-[12px]">Как заполнять справочник рамок</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1">
          <div className="bg-white rounded-md p-2.5 border border-blue-100">
            <p className="font-semibold mb-0.5">① Профиль</p>
            <p className="text-blue-600 leading-relaxed">Длина хлыста — стандартная длина, в которой продаётся профиль (напр. 2.9 м или 6 м). Закупка — цена за метр, которую вы платите поставщику. Запас 1.10 = система заказывает на 10% больше периметра, чтобы хватило на порезку углов под 45°.</p>
          </div>
          <div className="bg-white rounded-md p-2.5 border border-blue-100">
            <p className="font-semibold mb-0.5">② Трудозатраты</p>
            <p className="text-blue-600 leading-relaxed">Укажите только минуты на каждый этап — себестоимость сборки посчитается автоматически по ставке мастера из настроек производства. Ничего вручную вводить не нужно.</p>
          </div>
          <div className="bg-white rounded-md p-2.5 border border-blue-100">
            <p className="font-semibold mb-0.5">③ Продажа</p>
            <p className="text-blue-600 leading-relaxed">Цена продажи профиля за метр — та, которую вы закладываете клиенту (без работы). Стоимость сборки добавляется сверху отдельно. Итоговая цена видна в блоке «Расчёт».</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5">

        {/* ── FORM ── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg p-4 space-y-3 self-start">
          <p className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest">
            {editId ? `Редактирование #${editId}` : 'Новая рамка'}
          </p>

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className={lbl}>Название *</label>
              <input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Slim чёрный 20×20" />
            </div>
            <div>
              <label className={lbl}>Артикул <span className="text-[#c4c4be]">— ваш внутренний код</span></label>
              <input className={inp} value={form.article} onChange={e => setForm(f => ({ ...f, article: e.target.value }))} placeholder="FR-SL-BL-20" />
            </div>
            <div>
              <label className={lbl}>Размер профиля <span className="text-[#c4c4be]">— для КП</span></label>
              <input className={inp} value={form.profile_size} onChange={e => setForm(f => ({ ...f, profile_size: e.target.value }))} placeholder="20×20 мм" />
            </div>
          </div>

          {/* Type & Color */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Тип рамки</label>
              <select className={inp} value={form.frame_type} onChange={e => setForm(f => ({ ...f, frame_type: e.target.value }))}>
                {FRAME_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Цвет</label>
              <select className={inp} value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}>
                {FRAME_COLORS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Supplier */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>Поставщик</label>
              <input className={inp} value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Ссылка на позицию</label>
              <input className={inp} value={form.supplier_url} onChange={e => setForm(f => ({ ...f, supplier_url: e.target.value }))} placeholder="https://..." />
            </div>
          </div>

          {/* Profile economics */}
          <div className="pt-2 border-t border-[#f0f0ec]">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Профиль</p>
                <p className="text-[10px] text-[#b0b0aa]">Данные из прайса поставщика</p>
              </div>
              {/* Price mode toggle */}
              <div className="flex bg-[#f0f0ec] rounded-md p-0.5 gap-0.5">
                {(['per_m', 'per_whip'] as const).map(mode => (
                  <button key={mode} type="button"
                    onClick={() => setPriceMode(mode)}
                    className={`px-2 py-1 rounded text-[10px] font-semibold transition-all ${
                      priceMode === mode ? 'bg-white text-[#111110] shadow-sm' : 'text-[#9a9a95] hover:text-[#6b6b66]'
                    }`}>
                    {mode === 'per_m' ? '₽ за метр' : '₽ за хлыст'}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={lbl}>Хлыст, м</label>
                <input type="number" className={inp} value={form.whip_length_m} onChange={e => setForm(f => ({ ...f, whip_length_m: e.target.value }))} />
                <p className="text-[9px] text-[#c4c4be] mt-0.5">Стандартная длина из прайса</p>
              </div>
              <div>
                <label className={lbl}>Закупка {priceMode === 'per_whip' ? '₽/хлыст' : '₽/м'}</label>
                <input type="number" className={inp} value={form.cost_per_m} onChange={e => setForm(f => ({ ...f, cost_per_m: e.target.value }))} />
                {priceMode === 'per_whip' && _rawCost > 0 && _whipLen > 0 && (
                  <p className="text-[9px] text-emerald-600 mt-0.5">= {(_rawCost / _whipLen).toFixed(2)} ₽/м</p>
                )}
                {priceMode === 'per_m' && _rawCost > 0 && _whipLen > 0 && (
                  <p className="text-[9px] text-[#c4c4be] mt-0.5">= {Math.round(_rawCost * _whipLen)} ₽/хлыст</p>
                )}
              </div>
              <div>
                <label className={lbl}>Продажа {priceMode === 'per_whip' ? '₽/хлыст' : '₽/м'}</label>
                <input type="number" className={inp} value={form.sale_per_m} onChange={e => setForm(f => ({ ...f, sale_per_m: e.target.value }))} />
                {priceMode === 'per_whip' && _rawSale > 0 && _whipLen > 0 && (
                  <p className="text-[9px] text-emerald-600 mt-0.5">= {(_rawSale / _whipLen).toFixed(2)} ₽/м</p>
                )}
                {priceMode === 'per_m' && _rawSale > 0 && _whipLen > 0 && (
                  <p className="text-[9px] text-[#c4c4be] mt-0.5">= {Math.round(_rawSale * _whipLen)} ₽/хлыст</p>
                )}
              </div>
            </div>
            <div className="mt-2">
              <label className={lbl}>Коэффициент запаса <span className="text-[#c4c4be]">— обычно 1.10 (+10% на порезку углов)</span></label>
              <input type="number" step="0.01" className={`${inp} max-w-[120px]`} value={form.waste_factor} onChange={e => setForm(f => ({ ...f, waste_factor: e.target.value }))} />
            </div>
          </div>

          {/* Assembly work */}
          <div className="pt-2 border-t border-[#f0f0ec]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Трудозатраты</p>
            <p className="text-[10px] text-[#b0b0aa] mb-2">Укажите время — себестоимость посчитается автоматически</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={lbl}>Распил, мин</label>
                <input type="number" className={inp} value={form.cut_minutes} onChange={e => setForm(f => ({ ...f, cut_minutes: e.target.value }))} />
                <p className="text-[9px] text-[#c4c4be] mt-0.5">Порезка под 45°</p>
              </div>
              <div>
                <label className={lbl}>Сборка, мин</label>
                <input type="number" className={inp} value={form.assemble_minutes} onChange={e => setForm(f => ({ ...f, assemble_minutes: e.target.value }))} />
                <p className="text-[9px] text-[#c4c4be] mt-0.5">Сборка углов, крепёж</p>
              </div>
              <div>
                <label className={lbl}>Упаковка, мин</label>
                <input type="number" className={inp} value={form.pack_minutes} onChange={e => setForm(f => ({ ...f, pack_minutes: e.target.value }))} />
                <p className="text-[9px] text-[#c4c4be] mt-0.5">Пузырчатая плёнка и т.д.</p>
              </div>
            </div>

            {/* Live cost result */}
            <div className="mt-2.5 flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-md px-3 py-2">
              <div>
                <p className="text-[10px] text-emerald-700 font-semibold">
                  Итого {formTotalMinutes} мин × {minuteRate.toFixed(2)} ₽/мин
                </p>
                <p className="text-[9px] text-emerald-600 mt-0.5">
                  Ставка из production_settings (з/п {prodSettings.worker_monthly_salary.toLocaleString('ru-RU')} ₽/мес)
                </p>
              </div>
              <p className="text-sm font-bold font-mono text-emerald-700">
                {autoAssemblyCost.toLocaleString('ru-RU')} ₽
              </p>
            </div>

            {/* Override — advanced, hidden by default */}
            <button
              type="button"
              onClick={() => setShowOverride(v => !v)}
              className="mt-2 text-[10px] text-[#9a9a95] hover:text-[#6b6b66] flex items-center gap-1 transition-colors"
            >
              <svg className={`w-2.5 h-2.5 transition-transform ${showOverride ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              Зафиксировать стоимость вручную (override)
            </button>
            {showOverride && (
              <div className="mt-2 p-2.5 bg-amber-50 border border-amber-100 rounded-md">
                <p className="text-[10px] text-amber-700 mb-2">Заполните только если хотите указать фиксированную сумму вместо расчёта по минутам</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={lbl}>Себест. сборки ₽</label>
                    <input type="number" className={inp} value={form.assemble_cost_rub} onChange={e => setForm(f => ({ ...f, assemble_cost_rub: e.target.value }))} placeholder={`авто: ${Math.round(formTotalMinutes * minuteRate)}`} />
                  </div>
                  <div>
                    <label className={lbl}>Продажа сборки ₽</label>
                    <input type="number" className={inp} value={form.assemble_sale_rub} onChange={e => setForm(f => ({ ...f, assemble_sale_rub: e.target.value }))} placeholder={`авто: ${Math.round(formTotalMinutes * saleMinuteRate)}`} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Notes + meta */}
          <div className="pt-2 border-t border-[#f0f0ec]">
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className={lbl}>Сортировка</label>
                <input type="number" className={inp} value={form.sort_order} onChange={e => setForm(f => ({ ...f, sort_order: e.target.value }))} />
              </div>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                    className="w-3.5 h-3.5 rounded accent-blue-600" />
                  <span className="text-xs text-[#4b4b47]">Активна</span>
                </label>
              </div>
            </div>
            <label className={lbl}>Заметки</label>
            <textarea rows={2} className={`${inp} resize-none`} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {/* Preview calc */}
          <div className="pt-2 border-t border-[#f0f0ec]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Расчёт (превью)</p>
            <div className="flex gap-2 mb-2">
              <div className="flex-1">
                <label className={lbl}>Ширина мм</label>
                <input type="number" className={inp} value={previewW} onChange={e => setPreviewW(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className={lbl}>Высота мм</label>
                <input type="number" className={inp} value={previewH} onChange={e => setPreviewH(e.target.value)} />
              </div>
            </div>
            {preview && (
              <div className="bg-[#fafaf9] rounded-md p-2.5 space-y-1 text-[11px]">
                <div className="flex justify-between"><span className="text-[#9a9a95]">Периметр</span><span className="font-mono">{preview.perimeterM.toFixed(2)} м</span></div>
                <div className="flex justify-between"><span className="text-[#9a9a95]">Нужно профиля (+{Math.round((parseFloat(form.waste_factor)||1.1)*100-100)}% запас)</span><span className="font-mono">{preview.profileNeededM.toFixed(2)} м</span></div>
                <div className="flex justify-between"><span className="text-[#9a9a95]">Хлыстов × {preview.whipLengthM} м</span><span className="font-mono">{preview.whipsNeeded} шт (остаток {preview.leftoverM.toFixed(2)} м)</span></div>
                <div className="flex justify-between text-[#6b6b66] border-t border-[#e4e4e0] pt-1 mt-1"><span>Материал (себест.)</span><span className="font-mono font-medium">{fmt(preview.profileCost)} ₽</span></div>
                <div className="flex justify-between text-[#6b6b66]"><span>Сборка {preview.totalMinutes} мин (себест.)</span><span className="font-mono font-medium">{fmt(preview.assemblyCost)} ₽</span></div>
                <div className="flex justify-between text-[#111110] font-semibold border-t border-[#e4e4e0] pt-1 mt-1"><span>Итого себест.</span><span className="font-mono">{fmt(preview.totalCost)} ₽</span></div>
                <div className="flex justify-between text-blue-600"><span>Продажная стоимость</span><span className="font-mono">{fmt(preview.totalSale)} ₽</span></div>
              </div>
            )}
          </div>

          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button onClick={handleSave} disabled={saving}
            className="w-full py-2 bg-[#111110] text-white rounded-md text-sm font-semibold hover:bg-[#2a2a28] disabled:opacity-50 transition-colors">
            {saving ? 'Сохранение...' : editId ? 'Обновить' : 'Добавить рамку'}
          </button>
        </div>

        {/* ── TABLE ── */}
        <div>
          <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-[#fafaf9] border-b border-[#e4e4e0]">
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Название</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Тип / Цвет</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Хлыст</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Закупка</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Продажа</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide">Сборка, мин</th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide w-20">Статус</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {frames.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-[#9a9a95]">Нет рамок — добавьте первую</td></tr>
                )}
                {frames.map(f => {
                  const typeLabel  = FRAME_TYPES.find(t => t.value === f.frame_type)?.label ?? f.frame_type
                  const colorLabel = FRAME_COLORS.find(c => c.value === f.color)?.label ?? f.color
                  const totalMins  = f.cut_minutes + f.assemble_minutes + f.pack_minutes
                  return (
                    <tr key={f.id} className={`border-b border-[#f0f0ec] hover:bg-[#fafaf9] transition-colors ${!f.active ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-[#111110]">{f.name}</p>
                        {f.article && <p className="text-[10px] text-[#9a9a95]">{f.article}</p>}
                        {f.profile_size && <p className="text-[10px] text-[#b0b0aa]">{f.profile_size}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-[#6b6b66]">{typeLabel} · {colorLabel}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#4b4b47]">{f.whip_length_m} м</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#4b4b47]">{fmt(f.cost_per_m)} ₽/м</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[#4b4b47]">{fmt(f.sale_per_m)} ₽/м</td>
                      <td className="px-3 py-2.5 text-right text-[#6b6b66]">
                        {totalMins} мин
                        <div className="text-[10px] text-[#b0b0aa]">
                          {f.cut_minutes}+{f.assemble_minutes}+{f.pack_minutes}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button onClick={() => toggleActive(f)}
                          className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${f.active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[#f0f0ec] text-[#9a9a95] border-[#e4e4e0]'}`}>
                          {f.active ? 'Активна' : 'Откл.'}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => startEdit(f)} className="px-2 py-1 text-[11px] bg-[#f5f5f3] hover:bg-[#ebebea] rounded text-[#4b4b47] transition-colors">Ред.</button>
                          <button onClick={() => deleteFrame(f.id)} className="px-2 py-1 text-[11px] bg-red-50 hover:bg-red-100 rounded text-red-600 transition-colors">Удал.</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-[#9a9a95] mt-2 px-1">
            {frames.length} {frames.length === 1 ? 'рамка' : frames.length < 5 ? 'рамки' : 'рамок'} · ставка сборки: {minuteRate.toFixed(2)} ₽/мин (из production_settings)
          </p>
        </div>
      </div>
    </div>
  )
}
