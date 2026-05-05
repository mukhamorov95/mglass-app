'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import { B2BClient, B2BMaterial, B2BService } from '@/lib/types'

const MATERIAL_ORDER = [
  'Прозрачное М1',
  'Осветлённое CrystalVision',
  'Сатинированное бесцветное',
  'CrystalVision Matelux',
  'Тонированное (бронза/графит)',
  'Сатин тонированный',
]

function sortByPriority<T extends { name: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    const ai = MATERIAL_ORDER.indexOf(a.name)
    const bi = MATERIAL_ORDER.indexOf(b.name)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.name.localeCompare(b.name, 'ru')
  })
}

const DEFAULTS: Record<SuperCat, { thickness: number; name: string }> = {
  стекло:  { thickness: 8, name: 'Прозрачное М1' },
  зеркало: { thickness: 4, name: 'Зеркало осветлённое' },
}

function pickDefault(mats: B2BMaterial[], superCat: SuperCat) {
  const d = DEFAULTS[superCat]
  const preferred = mats.find(m => m.thickness === d.thickness && m.name === d.name)
  if (preferred) return preferred
  return sortByPriority(mats)[0] ?? null
}

const SUPER_CATS = [
  { value: 'стекло',  label: 'Стекло',  cats: ['стекло', 'тонированное', 'сатин', 'рифленое', 'декоративное'] },
  { value: 'зеркало', label: 'Зеркало', cats: ['зеркало'] },
] as const
type SuperCat = typeof SUPER_CATS[number]['value']
import {
  calcItem, calcTotals, WASTE_OPTIONS, TEMPERING_COST,
  type B2BOrderItem, type B2BOrderTotals,
} from '@/lib/b2bCalculator'

const fmt  = (n: number) => n.toLocaleString('ru-RU') + ' ₽'
const fmtN = (n: number, d = 3) => n.toLocaleString('ru-RU', { maximumFractionDigits: d })

function parseSalePrice(m: B2BMaterial): B2BMaterial {
  try {
    if (m.notes) {
      const n = JSON.parse(m.notes)
      return { ...m, sale_price: n?.sale_price ?? 0, passthrough: n?.passthrough ?? false }
    }
  } catch {}
  return { ...m, sale_price: 0, passthrough: false }
}

export default function B2BCalculatorPage() {
  const router = useRouter()
  const [clients, setClients]     = useState<B2BClient[]>([])
  const [materials, setMaterials] = useState<B2BMaterial[]>([])
  const [services, setServices]   = useState<B2BService[]>([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  const [clientId, setClientId]     = useState<number | null>(null)
  const [notes, setNotes]           = useState('')
  const [fProductionDays, setFProductionDays] = useState(7)
  const [items, setItems]           = useState<B2BOrderItem[]>([])

  const [fSuperCat, setFSuperCat]     = useState<SuperCat>('стекло')
  const [fThickness, setFThickness]   = useState<number | null>(null)
  const [fMatId, setFMatId]           = useState<number | null>(null)
  const [fWidth, setFWidth]           = useState('')
  const [fHeight, setFHeight]         = useState('')
  const [fQty, setFQty]               = useState('1')
  const [fWaste, setFWaste]           = useState(15)
  const [fTempering, setFTempering]   = useState(false)
  const [fServiceIds, setFServiceIds] = useState<number[]>([])
  const widthRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const [{ data: cls }, { data: mats }, { data: svcs }, { data: orders }] = await Promise.all([
        sb.from('b2b_clients').select('*').eq('active', true).order('name'),
        sb.from('b2b_materials').select('*').eq('active', true).order('category').order('name'),
        sb.from('b2b_services').select('*').eq('active', true).order('sort_order').order('name'),
        sb.from('b2b_orders').select('client_id,total_after_discount').gte('created_at', '2026-01-01'),
      ])

      const totals = new Map<number, number>()
      for (const o of orders ?? []) {
        totals.set(o.client_id, (totals.get(o.client_id) ?? 0) + o.total_after_discount)
      }
      const sorted = (cls ?? []).slice().sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
      setClients(sorted)
      const parsed = (mats ?? []).map(parseSalePrice)
      setMaterials(parsed)
      setServices(svcs ?? [])
      if (parsed.length > 0) {
        const sc = SUPER_CATS[0]
        setFSuperCat(sc.value)
        const superMats = parsed.filter(m => (sc.cats as readonly string[]).includes(m.category))
        const mat = pickDefault(superMats, sc.value)
        if (mat) { setFThickness(mat.thickness); setFMatId(mat.id); setFWaste(mat.waste_percent) }
      }
      setLoading(false)
    }
    load()
  }, [])

  const superCatDef      = SUPER_CATS.find(s => s.value === fSuperCat) ?? SUPER_CATS[0]
  const categoryMaterials  = useMemo(() => materials.filter(m => (superCatDef.cats as readonly string[]).includes(m.category)), [materials, fSuperCat])
  const availableThickness = useMemo(() => [...new Set(categoryMaterials.map(m => m.thickness))].sort((a, b) => a - b), [categoryMaterials])
  const thicknessMaterials = useMemo(() => sortByPriority(categoryMaterials.filter(m => m.thickness === fThickness)), [categoryMaterials, fThickness])

  function handleSuperCatChange(sc: SuperCat) {
    setFSuperCat(sc)
    if (sc === 'зеркало') setFTempering(false)
    const scDef = SUPER_CATS.find(s => s.value === sc)!
    const mats = materials.filter(m => (scDef.cats as readonly string[]).includes(m.category))
    const mat = pickDefault(mats, sc)
    if (mat) { setFThickness(mat.thickness); setFMatId(mat.id); setFWaste(mat.waste_percent) }
    else { setFThickness(null); setFMatId(null) }
  }

  function handleThicknessChange(t: number) {
    setFThickness(t)
    const mat = categoryMaterials.find(m => m.thickness === t)
    if (mat) { setFMatId(mat.id); setFWaste(mat.waste_percent) }
    else { setFMatId(null) }
  }

  const selectedClient   = clients.find(c => c.id === clientId) ?? null
  const discount         = selectedClient?.discount_percent ?? 0
  const selectedMaterial = materials.find(m => m.id === fMatId) ?? null
  const selectedServices = services.filter(s => fServiceIds.includes(s.id))

  function handleMaterialChange(id: number) {
    const mat = materials.find(m => m.id === id)
    setFMatId(id)
    if (mat) setFWaste(mat.passthrough ? 10 : mat.waste_percent)
  }

  function toggleService(id: number) {
    setFServiceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function handleAddItem() {
    if (!selectedMaterial) return
    const w = Number(fWidth) || 0
    const h = Number(fHeight) || 0
    const q = Number(fQty) || 1
    if (w <= 0 || h <= 0) return

    const calc = calcItem(selectedMaterial, w, h, q, fWaste, fTempering, selectedServices)
    setItems(prev => [...prev, { ...calc, localId: crypto.randomUUID() }])
    setFWidth('')
    setFHeight('')
    setFQty('1')
    widthRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAddItem()
  }

  function removeItem(localId: string) {
    setItems(prev => prev.filter(i => i.localId !== localId))
  }

  const totals: B2BOrderTotals | null = useMemo(() => {
    if (items.length === 0) return null
    return calcTotals(items, discount)
  }, [items, discount])

  async function handleSave() {
    if (items.length === 0 || !selectedClient) return
    setSaving(true)
    const t = totals!
    const avgMargin = items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.margin, 0) / items.length)
      : 0
    const orderNotes = JSON.stringify({
      status: 'quote',
      quote_date: new Date().toISOString(),
      production_days: fProductionDays,
      user_notes: notes || null,
    })
    const { error } = await createClient().from('b2b_orders').insert({
      client_id: clientId,
      client_name: selectedClient.name,
      discount_percent: discount,
      margin_percent: avgMargin,
      items: items,
      total_area: t.totalAreaNet,
      total_weight: t.totalWeight,
      total_cost_net: t.totalCostExVat,
      total_cost_vat: t.totalInputVat,
      total_sale_inc_vat: t.totalSaleIncVat,
      total_after_discount: t.totalAfterDiscount,
      notes: orderNotes,
    })
    if (!error) {
      router.push('/b2b-quotes')
    }
    setSaving(false)
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <div className="max-w-[1400px] mx-auto px-4 py-4">

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-[16px] font-semibold text-[#111110] tracking-tight">B2B Просчёт</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 items-start">

          {/* ══ ЛЕВАЯ КОЛОНКА ══ */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3 lg:sticky lg:top-4">

            {/* Клиент */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Клиент</label>
              <select
                className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                value={clientId ?? ''}
                onChange={e => setClientId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">— Выберите клиента —</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.discount_percent > 0 ? ` (−${c.discount_percent}%)` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Дней производства */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Срок производства, дней</label>
              <input type="number" min="1" max="90"
                className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                value={fProductionDays}
                onChange={e => setFProductionDays(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <div className="h-px bg-[#f0f0ec]" />

            {/* Стекло / Зеркало — табы */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Материал</label>
              <div className="flex gap-1.5">
                {SUPER_CATS.filter(s => materials.some(m => (s.cats as readonly string[]).includes(m.category))).map(s => (
                  <button key={s.value} onClick={() => handleSuperCatChange(s.value)}
                    className={`flex-1 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${fSuperCat === s.value ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66] hover:bg-[#e8e8e4]'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Толщина + Тип */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Толщина</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fThickness ?? ''}
                  onChange={e => handleThicknessChange(Number(e.target.value))}>
                  {availableThickness.map(t => <option key={t} value={t}>{t} мм</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Тип</label>
                <select
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fMatId ?? ''}
                  onChange={e => handleMaterialChange(Number(e.target.value))}>
                  {thicknessMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            {/* Инфо */}
            {selectedMaterial && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f8f8f7] rounded-lg text-[12px]">
                {selectedMaterial.sale_price > 0
                  ? <span className="font-semibold text-[#111110] font-mono">{selectedMaterial.sale_price.toLocaleString('ru-RU')} ₽/м²</span>
                  : <span className="text-orange-500 font-medium">цена не задана</span>}
                <span className="text-[#d4d4ce]">·</span>
                {selectedMaterial.passthrough
                  ? <span className="text-orange-500 font-medium">проходной · отход 10%</span>
                  : <span className="text-[#8a8a85]">отход {selectedMaterial.waste_percent}%</span>}
                {TEMPERING_COST[selectedMaterial.thickness] && <>
                  <span className="text-[#d4d4ce]">·</span>
                  <span className="text-[#8a8a85]">закалка {TEMPERING_COST[selectedMaterial.thickness]} ₽/м²</span>
                </>}
              </div>
            )}

            <div className="h-px bg-[#f0f0ec]" />

            {/* Размеры */}
            <div>
              <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Размеры и количество</label>
              <div className="grid grid-cols-3 gap-2">
                <input ref={widthRef} type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fWidth} onChange={e => setFWidth(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ш, мм" />
                <input type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fHeight} onChange={e => setFHeight(e.target.value)} onKeyDown={handleKeyDown} placeholder="В, мм" />
                <input type="number" min="1"
                  className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all"
                  value={fQty} onChange={e => setFQty(e.target.value)} onKeyDown={handleKeyDown} placeholder="Шт" />
              </div>
            </div>

            {/* Отход + Закалка */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">
                  Отход листа
                  {selectedMaterial?.passthrough && <span className="ml-1 text-orange-500 normal-case font-normal text-[10px]">фикс.</span>}
                </label>
                {selectedMaterial?.passthrough ? (
                  <div className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-orange-600 font-semibold">
                    10% — проходной
                  </div>
                ) : (
                  <select
                    className="w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] text-[#111110] outline-none focus:border-[#111110] transition-all"
                    value={fWaste} onChange={e => setFWaste(Number(e.target.value))}>
                    {WASTE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
              </div>
              {fSuperCat === 'стекло' && (
                <div>
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Опции</label>
                  <label className="flex items-center gap-2 h-[34px] px-3 border border-[#e4e4e0] rounded-lg cursor-pointer hover:border-[#c4c4be] transition-all">
                    <input type="checkbox" checked={fTempering} onChange={e => setFTempering(e.target.checked)}
                      className="w-3.5 h-3.5 rounded accent-[#111110]" />
                    <span className="text-[13px] text-[#111110]">Закалка</span>
                  </label>
                </div>
              )}
            </div>

            {/* Кнопка добавить */}
            <button
              onClick={handleAddItem}
              disabled={!selectedMaterial || !fWidth || !fHeight || (selectedMaterial?.sale_price ?? 0) === 0}
              className="w-full bg-[#111110] text-white text-[14px] font-semibold py-2.5 rounded-lg hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
              + Добавить позицию
            </button>

            {/* Доп. услуги */}
            {services.length > 0 && (
              <details className="group">
                <summary className="flex items-center justify-between px-3 py-2 rounded-lg border border-[#e4e4e0] cursor-pointer select-none list-none hover:bg-[#fafaf9] transition-colors">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Доп. услуги</span>
                  <div className="flex items-center gap-2">
                    {fServiceIds.length > 0 && (
                      <span className="text-[10px] font-semibold bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full">{fServiceIds.length}</span>
                    )}
                    <span className="text-[#c4c4be] text-[10px] group-open:rotate-180 transition-transform inline-block">▼</span>
                  </div>
                </summary>
                <div className="mt-1 border border-[#e4e4e0] rounded-lg overflow-hidden">
                  {services.map(s => {
                    const checked = fServiceIds.includes(s.id)
                    return (
                      <label key={s.id} className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors border-b border-[#f8f8f7] last:border-0 ${checked ? 'bg-blue-50' : 'hover:bg-[#fafaf9]'}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleService(s.id)}
                          className="w-3 h-3 rounded accent-[#111110] flex-shrink-0" />
                        <span className="text-[12px] text-[#111110] flex-1 leading-tight">{s.name}</span>
                        <span className="text-[11px] text-[#9a9a95] flex-shrink-0 font-mono">
                          {s.type === 'percent' ? `${s.value}%` : `${s.value.toLocaleString('ru-RU')} ₽`}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </details>
            )}

            {/* Примечание */}
            <details className="group">
              <summary className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none hover:text-[#6b6b66] transition-colors">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                Примечание
              </summary>
              <textarea
                className="mt-2 w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110] transition-all resize-none"
                rows={2} value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Комментарий к заказу..."
              />
            </details>
          </div>

          {/* ══ ПРАВАЯ КОЛОНКА ══ */}
          <div className="space-y-4">

            {/* Таблица позиций */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#f0f0ec] flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">
                    Позиции {items.length > 0 && `— ${items.length} шт.`}
                  </span>
                  {selectedClient && (
                    <span className="text-[12px] text-[#6b6b66]">{selectedClient.name}</span>
                  )}
                  {discount > 0 && (
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">скидка {discount}%</span>
                  )}
                </div>
                {items.length > 0 && (
                  <button onClick={() => setItems([])} className="text-[11px] text-red-400 hover:text-red-600 transition-colors">
                    Очистить всё
                  </button>
                )}
              </div>

              {items.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-[#c4c4be]">Добавьте первую позицию</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-[#f0f0ec] bg-[#fafaf9] text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest whitespace-nowrap">
                        <th className="px-3 py-2.5 text-center w-8">#</th>
                        <th className="px-3 py-2.5 text-left min-w-[140px]">Материал</th>
                        <th className="px-3 py-2.5 text-left min-w-[80px]">Тип</th>
                        <th className="px-3 py-2.5 text-right w-14">Толщ.</th>
                        <th className="px-3 py-2.5 text-right w-16">Ш, мм</th>
                        <th className="px-3 py-2.5 text-right w-16">В, мм</th>
                        <th className="px-3 py-2.5 text-right w-12">Кол.</th>
                        <th className="px-3 py-2.5 text-right w-16">Кв.м</th>
                        <th className="px-3 py-2.5 text-right w-16">Вес, кг</th>
                        <th className="px-3 py-2.5 text-right w-20">Цена/м²</th>
                        <th className="px-3 py-2.5 text-right w-14">Скид.%</th>
                        <th className="px-3 py-2.5 text-right w-24 text-[#111110]">Итого</th>
                        <th className="px-3 py-2.5 text-right w-24 text-[#9a9a95]">Себест.</th>
                        <th className="w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f8f8f7]">
                      {items.map((item, idx) => {
                        const itemAfterDiscount = Math.round(item.saleIncVat * (1 - discount / 100))
                        return (
                          <tr key={item.localId} className="hover:bg-[#fafaf9] transition-colors">
                            <td className="px-3 py-2.5 text-center text-[10px] font-bold text-[#c4c4be]">{idx + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-[#111110]">{item.materialName}</div>
                              {(item.hasTempering || item.services.length > 0) && (
                                <div className="flex gap-1 mt-0.5 flex-wrap">
                                  {item.hasTempering && (
                                    <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-orange-50 text-orange-600">закалка</span>
                                  )}
                                  {item.services.map(s => (
                                    <span key={s.id} className="text-[9px] font-medium px-1 py-0.5 rounded bg-blue-50 text-blue-600">{s.name}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-[#6b6b66] whitespace-nowrap">{item.category}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.thickness}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.width}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.height}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.quantity}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{fmtN(item.totalAreaNet)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{fmtN(item.totalWeight, 1)}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#111110]">{item.pricePerM2.toLocaleString('ru-RU')}</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{discount > 0 ? `${discount}%` : '—'}</td>
                            <td className="px-3 py-2.5 text-right font-mono font-semibold text-[#111110] whitespace-nowrap">{itemAfterDiscount.toLocaleString('ru-RU')} ₽</td>
                            <td className="px-3 py-2.5 text-right font-mono text-[#9a9a95] whitespace-nowrap">{item.costExVat.toLocaleString('ru-RU')} ₽</td>
                            <td className="px-3 py-2.5 text-center">
                              <button onClick={() => removeItem(item.localId)}
                                className="text-[#c4c4be] hover:text-red-400 transition-colors text-lg leading-none">×</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    {totals && (
                      <tfoot>
                        <tr className="border-t-2 border-[#e4e4e0] bg-[#fafaf9] font-semibold text-[#111110]">
                          <td className="px-3 py-2.5 text-center text-[10px] font-bold text-[#9a9a95]">∑</td>
                          <td className="px-3 py-2.5 text-[11px] text-[#6b6b66]">{items.length} позиций</td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td></td>
                          <td className="px-3 py-2.5 text-right font-mono">{items.reduce((s, i) => s + i.quantity, 0)}</td>
                          <td className="px-3 py-2.5 text-right font-mono">{fmtN(totals.totalAreaNet)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#6b6b66]">{fmtN(totals.totalWeight, 1)}</td>
                          <td></td>
                          <td></td>
                          <td className="px-3 py-2.5 text-right font-mono font-bold whitespace-nowrap">{fmt(totals.totalAfterDiscount)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#9a9a95] whitespace-nowrap">{totals.totalCostExVat.toLocaleString('ru-RU')} ₽</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>

            {/* Итоговый блок + кнопка сохранить */}
            {totals && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-[#6b6b66]">
                      {discount > 0 ? (
                        <>Сумма {fmt(totals.totalSaleIncVat)} · <span className="text-emerald-600">скидка {discount}%</span></>
                      ) : (
                        <>Сумма заказа</>
                      )}
                    </p>
                    <p className="text-[24px] font-bold text-[#111110] font-mono">{fmt(totals.totalAfterDiscount)}</p>
                  </div>
                  <div className="text-right text-[12px] text-[#8a8a85]">
                    <p>{fmtN(totals.totalAreaNet)} м²</p>
                    <p>{fmtN(totals.totalWeight, 1)} кг</p>
                  </div>
                </div>

                <details className="group">
                  <summary className="text-[11px] font-semibold uppercase tracking-widest text-[#9a9a95] cursor-pointer select-none list-none flex items-center gap-1.5">
                    <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
                    Аналитика (только для менеджера)
                  </summary>
                  <div className="mt-3 space-y-1.5 border-t border-[#f0f0ec] pt-3 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">Себестоимость без НДС</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.totalCostExVat)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">Продажа без НДС</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.totalSaleExVat)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#6b6b66]">НДС к уплате в бюджет</span>
                      <span className="font-mono text-[#111110]">{fmt(totals.vatToState)}</span>
                    </div>
                    <div className="flex justify-between font-semibold border-t border-[#f0f0ec] pt-1.5 mt-1.5">
                      <span className="text-[#111110]">Прибыль (ориент.)</span>
                      <span className={`font-mono ${totals.profit > 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(totals.profit)}</span>
                    </div>
                  </div>
                </details>

                <button onClick={handleSave} disabled={saving || !clientId || items.length === 0}
                  className="w-full bg-[#111110] text-white text-[14px] font-semibold py-3 rounded-xl hover:bg-[#2a2a28] disabled:opacity-40 transition-colors">
                  {saving ? 'Сохранение...' : !clientId ? 'Выберите клиента' : 'Сохранить просчёт'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
