'use client'

import { useState, useEffect, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type ProductLine = {
  id: number
  category: string
  line_type: string
  name: string
  tagline: string | null
  target_audience: string | null
  status: string
  sort_order: number
}

type UnitEconomics = {
  id: number
  sku_id: number
  cost_glass: number; cost_mirror: number; cost_hardware: number; cost_profile: number
  cost_packaging: number; cost_led: number; cost_power_supply: number; cost_assembly: number
  cost_installation: number; cost_delivery: number; cost_tempering: number; cost_consumables: number
  cost_defects_pct: number
  tax_pct: number; ads_pct: number; manager_commission_pct: number; partner_commission_pct: number
  warranty_pct: number; returns_pct: number; storage_pct: number; overhead_pct: number; content_pct: number
  cac: number
  price_retail_override: number
}

type Sku = {
  id: number
  line_id: number | null
  sku: string
  name: string
  category: string
  sub_type: string | null
  width_mm: number | null
  height_mm: number | null
  depth_mm: number | null
  color: string | null
  form: string | null
  materials: string[]
  hardware_list: string[]
  weight_kg: number | null
  status: string
  notes: string | null
  photo_url: string | null
  product_unit_economics: UnitEconomics[] | null
}

type ChecklistItem = { id: number; sku_id: number; item: string; done: boolean; sort_order: number }

type Influencer = {
  id: number
  name: string
  platform: string
  handle: string | null
  url: string | null
  followers: number
  niche: string | null
  er_pct: number
  avg_views: number
  cost_per_post: number
  status: string
  city: string | null
  notes: string | null
}

type Campaign = {
  id: number
  influencer_id: number
  sku_id: number | null
  title: string
  campaign_date: string | null
  product_cost: number
  payment: number
  views: number
  leads: number
  orders: number
  revenue: number
  content_url: string | null
  status: string
  notes: string | null
  influencers?: { name: string; platform: string; handle: string | null }
}

// ─── Calculation engine ───────────────────────────────────────────────────────

function calcUE(ue: UnitEconomics) {
  const directRaw =
    ue.cost_glass + ue.cost_mirror + ue.cost_hardware + ue.cost_profile +
    ue.cost_packaging + ue.cost_led + ue.cost_power_supply + ue.cost_assembly +
    ue.cost_installation + ue.cost_delivery + ue.cost_tempering + ue.cost_consumables

  const directWithDefects = directRaw * (1 + ue.cost_defects_pct / 100)

  const indirectPct =
    ue.tax_pct + ue.ads_pct + ue.manager_commission_pct + ue.partner_commission_pct +
    ue.warranty_pct + ue.returns_pct + ue.storage_pct + ue.overhead_pct + ue.content_pct

  const breakEven = indirectPct < 100
    ? directWithDefects / (1 - indirectPct / 100) + ue.cac
    : directWithDefects + ue.cac

  const retailPrice = ue.price_retail_override > 0 ? ue.price_retail_override : breakEven / (1 - 0.40)

  const priceMin      = breakEven / (1 - 0.15)
  const priceStandard = breakEven / (1 - 0.30)
  const priceRecommended = breakEven / (1 - 0.40)
  const pricePremium  = breakEven / (1 - 0.60)
  const priceDealer   = retailPrice * 0.75
  const priceDesigner = retailPrice * 0.85
  const priceMarketplace = retailPrice * 1.20

  const grossMarginPct = retailPrice > 0 ? (retailPrice - directWithDefects) / retailPrice * 100 : 0
  const netMarginPct   = retailPrice > 0 ? (retailPrice - breakEven) / retailPrice * 100 : 0

  return {
    directRaw, directWithDefects, indirectPct, breakEven, retailPrice,
    priceMin, priceStandard, priceRecommended, pricePremium,
    priceDealer, priceDesigner, priceMarketplace,
    grossMarginPct, netMarginPct,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const r = (n: number) => Math.round(n).toLocaleString('ru')
const p = (n: number) => n.toFixed(1)

const CATEGORY_LABELS: Record<string, string> = {
  shower: 'Душевые', mirror: 'Зеркала', loft: 'Лофт', office: 'Офис',
}
const LINE_LABELS: Record<string, string> = {
  basic: 'Basic', standard: 'Standard', premium: 'Premium',
}
const STATUS_COLORS: Record<string, string> = {
  concept: 'bg-gray-100 text-gray-600',
  development: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<string, string> = {
  concept: 'Концепт', development: 'Разработка', active: 'Активен', archived: 'Архив',
}
const INF_STATUS_COLORS: Record<string, string> = {
  prospect: 'bg-gray-100 text-gray-600',
  contacted: 'bg-blue-100 text-blue-700',
  negotiating: 'bg-amber-100 text-amber-700',
  active: 'bg-green-100 text-green-700',
  done: 'bg-purple-100 text-purple-700',
  pass: 'bg-red-100 text-red-600',
}

// ─── STRATEGY TAB ─────────────────────────────────────────────────────────────

const BLIND_ZONES = [
  {
    icon: '💥', label: 'SKU-взрыв убьёт маржу',
    text: 'Каждый нестандартный размер = отдельный SKU → сложность производства, склада, продаж. Начать с 3-5 стандартных размеров на линейку. Всё остальное — кастом по наценке.',
    risk: 'high',
  },
  {
    icon: '📦', label: 'Стекло и e-commerce несовместимы без спецупаковки',
    text: 'Хрупкость стекла делает доставку по РФ дорогой и рискованной. Wildberries/Ozon не возьмут без сертифицированной упаковки. Упаковка может составить 10-15% себестоимости.',
    risk: 'high',
  },
  {
    icon: '🏭', label: 'Товарный запас = замороженные деньги',
    text: 'Для продуктовой модели нужен склад готовых изделий. При 20 SKU × средний запас 5 шт × средняя стоимость = несколько миллионов в остатках. Начать с производства под заказ с фиксированными размерами.',
    risk: 'high',
  },
  {
    icon: '🇨🇳', label: 'Китайский импорт дешевле в 2-3 раза',
    text: 'В категории Basic конкуренция с китайскими изделиями через маркетплейсы нереальна. MGlass должен идти в Standard+ с упором на качество стекла, монтаж и сервис.',
    risk: 'medium',
  },
  {
    icon: '📦', label: 'Закон о ЗПП — проблема для e-commerce',
    text: 'Стекло по закону не подлежит возврату (изделие, изготовленное по размерам). Но на маркетплейсах клиенты всё равно пытаются вернуть. Нужна чёткая политика и юридическая защита.',
    risk: 'medium',
  },
  {
    icon: '🔄', label: 'Монтаж нельзя масштабировать так же быстро, как продажи',
    text: 'Если продажи вырастут в 5 раз — нужно в 5 раз больше монтажников. Продуктовая модель должна включать "самомонтаж" (душевые, зеркала) или партнёрскую сеть установщиков.',
    risk: 'medium',
  },
  {
    icon: '🎯', label: 'Другая аудитория, другие продажи',
    text: 'Кастом-клиент приходит через замер и доверие. Продуктовый клиент приходит через контент и цену. Это разные воронки, разные менеджеры, разные скрипты. Нельзя смешивать.',
    risk: 'medium',
  },
  {
    icon: '📊', label: 'Маркетплейсы заберут 20-35% комиссии',
    text: 'Wildberries берёт 15-35%. Ozon — аналогично. На зеркале за 15 000 ₽ комиссия 4 000-5 000 ₽. Это должно быть заложено в unit-экономику. Многие выходят на маркетплейсы и уходят в минус.',
    risk: 'high',
  },
  {
    icon: '🏗️', label: 'Первые SKU — самые важные',
    text: 'Запустить слишком много SKU = не запустить ни одного нормально. Правило: 1 категория × 2 размера × 2 цвета = 4 SKU. Довести до совершенства, потом масштабировать.',
    risk: 'low',
  },
  {
    icon: '💡', label: 'Бренд строится контентом, не каталогом',
    text: 'Успешные примеры (Hansgrohe, Ravak, Kermi) — это не просто товары. Это истории, видео, дизайн. MGlass нужен не каталог, а медийный продукт-бренд.',
    risk: 'low',
  },
]

const PRIORITY_SKUS = [
  { name: 'Душевая 900×2000 (чёрная)', why: 'Самый популярный запрос. Простой монтаж. Нет китайских аналогов в premium.' },
  { name: 'Зеркало 800×800 с подсветкой', why: 'Viral-контент. Высокая маржа. Отлично работает через Reels.' },
  { name: 'Зеркало 1000×600 с подсветкой', why: 'Размер для ванных. Огромный рынок. Хорошо идёт через маркетплейсы.' },
  { name: 'Душевая 1200×2000 (хром)', why: 'B2B спрос. Гостиницы, апартаменты, застройщики.' },
]

function StrategyTab() {
  return (
    <div className="space-y-6">
      {/* Vision */}
      <div className="bg-gradient-to-br from-[#111110] to-[#333] text-white rounded-2xl p-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest opacity-60 mb-2">Стратегия</p>
        <h2 className="text-[22px] font-bold leading-tight mb-3">
          MGlass: от локального производства → к product brand
        </h2>
        <p className="text-[13px] opacity-75 leading-relaxed">
          Цель — не заменить кастом-бизнес, а построить параллельный масштабируемый поток:
          готовые продукты → контент → маркетплейсы → партнёры → вся Россия.
        </p>
        <div className="grid grid-cols-3 gap-4 mt-5 pt-5 border-t border-white/20">
          {[
            { label: 'Сейчас', text: 'Кастом под заказ\nМосква\nVladislav-зависимость' },
            { label: 'Год 1', text: '5-10 серийных SKU\nMock запуск на WB/Ozon\n1 линейка зеркал' },
            { label: 'Год 2-3', text: '30+ SKU\nРФ-доставка\nИнфлюенсер-канал' },
          ].map(s => (
            <div key={s.label}>
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-1">{s.label}</p>
              <pre className="text-[12px] opacity-85 whitespace-pre-wrap font-sans leading-relaxed">{s.text}</pre>
            </div>
          ))}
        </div>
      </div>

      {/* Priority SKUs */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
        <p className="text-[12px] font-semibold text-[#111110] mb-1">Запускать первыми — именно эти SKU</p>
        <p className="text-[11px] text-[#8a8a85] mb-4">Максимальный потенциал при минимальной сложности</p>
        <div className="space-y-3">
          {PRIORITY_SKUS.map((s, i) => (
            <div key={i} className="flex gap-3 items-start">
              <span className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                {i + 1}
              </span>
              <div>
                <p className="text-[13px] font-semibold text-[#111110]">{s.name}</p>
                <p className="text-[12px] text-[#6b6b66]">{s.why}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Blind zones */}
      <div>
        <p className="text-[12px] font-semibold text-[#111110] mb-1">Слепые зоны — что owner не замечает</p>
        <p className="text-[11px] text-[#8a8a85] mb-4">
          Критический анализ перед запуском продуктовой модели
        </p>
        <div className="grid grid-cols-2 gap-3">
          {BLIND_ZONES.map((z, i) => (
            <div key={i} className={`rounded-xl p-4 border ${
              z.risk === 'high' ? 'bg-red-50 border-red-200' :
              z.risk === 'medium' ? 'bg-amber-50 border-amber-200' :
              'bg-blue-50 border-blue-200'
            }`}>
              <div className="flex items-start gap-2 mb-1.5">
                <span className="text-[16px] flex-shrink-0">{z.icon}</span>
                <p className={`text-[12px] font-semibold leading-tight ${
                  z.risk === 'high' ? 'text-red-800' :
                  z.risk === 'medium' ? 'text-amber-800' : 'text-blue-800'
                }`}>{z.label}</p>
              </div>
              <p className={`text-[11px] leading-relaxed ${
                z.risk === 'high' ? 'text-red-700' :
                z.risk === 'medium' ? 'text-amber-700' : 'text-blue-700'
              }`}>{z.text}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Не делать */}
      <div className="bg-white border border-[#e4e4e0] rounded-xl p-5">
        <p className="text-[12px] font-semibold text-[#111110] mb-3">Чего НЕ делать при запуске</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            'Запускать 50 SKU сразу — размоете внимание и деньги',
            'Выходить на WB/Ozon без спецупаковки для стекла',
            'Делать SKU "любого размера" — это не продукт, это кастом',
            'Игнорировать unit-экономику маркетплейсов (комиссия 20-35%)',
            'Нанимать менеджеров по продукту из кастом-продаж',
            'Копировать конкурентов в Basic-сегменте (там Китай)',
            'Запускать без фото/видео — продукт без контента не продаётся',
            'Планировать монтаж для всей РФ без партнёрской сети',
          ].map((item, i) => (
            <div key={i} className="flex gap-2 text-[12px] text-[#6b6b66]">
              <span className="text-red-400 flex-shrink-0">✕</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── MATRIX TAB ───────────────────────────────────────────────────────────────

function MatrixTab() {
  const [lines, setLines] = useState<ProductLine[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ category: 'shower', line_type: 'standard', name: '', tagline: '', status: 'concept' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/admin/product-lines').then(r => r.json()).then(d => {
      setLines(Array.isArray(d) ? d : [])
      setLoading(false)
    })
  }, [])

  async function add() {
    if (!form.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/admin/product-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (res.ok) {
      const created = await res.json()
      setLines(prev => [...prev, created])
      setForm({ category: 'shower', line_type: 'standard', name: '', tagline: '', status: 'concept' })
      setShowAdd(false)
    }
    setSaving(false)
  }

  async function updateStatus(id: number, status: string) {
    await fetch('/api/admin/product-lines', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setLines(prev => prev.map(l => l.id === id ? { ...l, status } : l))
  }

  async function del(id: number) {
    await fetch('/api/admin/product-lines', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setLines(prev => prev.filter(l => l.id !== id))
  }

  const byCategory = Object.entries(CATEGORY_LABELS).map(([cat, label]) => ({
    cat, label,
    lines: lines.filter(l => l.category === cat),
  }))

  return (
    <div className="space-y-5">
      <div className="flex justify-between items-center">
        <div>
          <p className="text-[14px] font-semibold text-[#111110]">Матрица продуктовых линеек</p>
          <p className="text-[12px] text-[#8a8a85]">Управление категориями и линейками</p>
        </div>
        <button onClick={() => setShowAdd(v => !v)}
          className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium hover:bg-[#333] transition-colors">
          + Добавить линейку
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Новая продуктовая линейка</p>
          <div className="grid grid-cols-3 gap-3">
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={form.line_type} onChange={e => setForm(f => ({ ...f, line_type: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              {Object.entries(LINE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input placeholder="Название линейки *" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <input placeholder="Слоган (необязательно)" value={form.tagline}
              onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
          </div>
          <div className="flex gap-2">
            <button onClick={add} disabled={!form.name.trim() || saving}
              className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium disabled:opacity-50">
              {saving ? 'Сохранение...' : 'Создать'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-[#e4e4e0] text-[#6b6b66] rounded-xl text-[12px]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-[13px] text-[#8a8a85]">Загрузка...</div>
      ) : (
        <div className="space-y-6">
          {byCategory.map(({ cat, label, lines: catLines }) => (
            <div key={cat}>
              <p className="text-[11px] font-bold uppercase tracking-widest text-[#8a8a85] mb-3">{label}</p>
              {catLines.length === 0 ? (
                <p className="text-[12px] text-[#8a8a85] italic pl-2">Линеек нет</p>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {catLines.map(line => (
                    <div key={line.id} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[line.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STATUS_LABELS[line.status] ?? line.status}
                          </span>
                          <span className="ml-1.5 text-[10px] text-[#8a8a85]">{LINE_LABELS[line.line_type] ?? line.line_type}</span>
                        </div>
                        <button onClick={() => del(line.id)} className="text-[#c4c4c0] hover:text-red-400 text-[12px]">×</button>
                      </div>
                      <p className="text-[14px] font-semibold text-[#111110]">{line.name}</p>
                      {line.tagline && <p className="text-[11px] text-[#8a8a85] mt-0.5 italic">{line.tagline}</p>}
                      <div className="mt-3 flex gap-1">
                        {Object.entries(STATUS_LABELS).map(([s, sl]) => (
                          <button key={s} onClick={() => updateStatus(line.id, s)}
                            disabled={line.status === s}
                            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                              line.status === s
                                ? 'bg-[#111110] text-white border-[#111110]'
                                : 'border-[#e4e4e0] text-[#8a8a85] hover:border-gray-400'
                            }`}>
                            {sl}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── UNIT ECONOMICS PANEL ─────────────────────────────────────────────────────

const UE_DIRECT_FIELDS: { key: keyof UnitEconomics; label: string }[] = [
  { key: 'cost_glass',         label: 'Стекло' },
  { key: 'cost_mirror',        label: 'Зеркало' },
  { key: 'cost_hardware',      label: 'Фурнитура' },
  { key: 'cost_profile',       label: 'Профиль' },
  { key: 'cost_packaging',     label: 'Упаковка' },
  { key: 'cost_led',           label: 'LED' },
  { key: 'cost_power_supply',  label: 'Блок питания' },
  { key: 'cost_assembly',      label: 'Сборка' },
  { key: 'cost_installation',  label: 'Монтаж' },
  { key: 'cost_delivery',      label: 'Доставка' },
  { key: 'cost_tempering',     label: 'Закалка' },
  { key: 'cost_consumables',   label: 'Расходники' },
]

const UE_INDIRECT_FIELDS: { key: keyof UnitEconomics; label: string }[] = [
  { key: 'tax_pct',                label: 'Налог (%)' },
  { key: 'ads_pct',                label: 'Реклама (%)' },
  { key: 'manager_commission_pct', label: 'Комиссия менеджера (%)' },
  { key: 'partner_commission_pct', label: 'Комиссия партнёра (%)' },
  { key: 'warranty_pct',           label: 'Гарантия (%)' },
  { key: 'returns_pct',            label: 'Возвраты (%)' },
  { key: 'storage_pct',            label: 'Хранение (%)' },
  { key: 'overhead_pct',           label: 'Накладные (%)' },
  { key: 'content_pct',            label: 'Контент (%)' },
]

function UEPanel({ sku }: { sku: Sku }) {
  const raw = sku.product_unit_economics?.[0]
  const [ue, setUE] = useState<UnitEconomics | null>(raw ?? null)
  const [saving, setSaving] = useState(false)

  const calc = ue ? calcUE(ue) : null

  function update(key: keyof UnitEconomics, val: number) {
    setUE(prev => prev ? { ...prev, [key]: val } : prev)
  }

  async function save() {
    if (!ue) return
    setSaving(true)
    await fetch('/api/admin/product-ue', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...ue, sku_id: sku.id }),
    })
    setSaving(false)
  }

  if (!ue) return (
    <div className="text-[12px] text-[#8a8a85] p-3">Нет данных unit-экономики</div>
  )

  const marginColor = (pct: number) =>
    pct >= 35 ? 'text-green-600' : pct >= 20 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="border-t border-[#e4e4e0] mt-3 pt-4 space-y-4">
      {/* Calculated results */}
      {calc && (
        <div className="bg-[#f8f8f6] rounded-xl p-4">
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-3">Результат расчёта</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Прямые расходы</span>
              <span className="font-medium text-[#111110]">{r(calc.directWithDefects)} ₽</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Косвенные (% от цены)</span>
              <span className="font-medium text-[#111110]">{p(calc.indirectPct)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Точка безубыточности</span>
              <span className="font-semibold text-[#111110]">{r(calc.breakEven)} ₽</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Розничная цена</span>
              <span className="font-bold text-[#111110]">{r(calc.retailPrice)} ₽</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Валовая маржа</span>
              <span className={`font-semibold ${marginColor(calc.grossMarginPct)}`}>{p(calc.grossMarginPct)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#6b6b66]">Чистая маржа</span>
              <span className={`font-bold ${marginColor(calc.netMarginPct)}`}>{p(calc.netMarginPct)}%</span>
            </div>
          </div>

          {/* Margin warning */}
          {calc.netMarginPct < 20 && (
            <div className="mt-3 bg-red-100 border border-red-200 rounded-lg px-3 py-2">
              <p className="text-[11px] text-red-700 font-semibold">
                ⚠ Маржа ниже 20% — продукт убыточен при росте затрат. Пересмотри расходы или цену.
              </p>
            </div>
          )}
          {calc.netMarginPct >= 20 && calc.netMarginPct < 30 && (
            <div className="mt-3 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-[11px] text-amber-700 font-semibold">
                ⚡ Маржа 20-30% — допустимо, но хрупко. Любой рост стоимости материалов съест прибыль.
              </p>
            </div>
          )}

          {/* Price grid */}
          <div className="mt-4 pt-3 border-t border-[#e4e4e0]">
            <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Ценовая матрица</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Минимум (15%)',   val: calc.priceMin,        cls: 'bg-red-50 border-red-200 text-red-800' },
                { label: 'Стандарт (30%)',  val: calc.priceStandard,   cls: 'bg-amber-50 border-amber-200 text-amber-800' },
                { label: 'Рекомендован (40%)', val: calc.priceRecommended, cls: 'bg-green-50 border-green-200 text-green-800' },
                { label: 'Premium (60%)',   val: calc.pricePremium,    cls: 'bg-purple-50 border-purple-200 text-purple-800' },
                { label: 'Дилер (-25%)',    val: calc.priceDealer,     cls: 'bg-blue-50 border-blue-200 text-blue-800' },
                { label: 'Дизайнер (-15%)',val: calc.priceDesigner,   cls: 'bg-indigo-50 border-indigo-200 text-indigo-800' },
              ].map(pr => (
                <div key={pr.label} className={`rounded-lg border px-2 py-2 text-center ${pr.cls}`}>
                  <p className="text-[10px] font-medium opacity-70">{pr.label}</p>
                  <p className="text-[13px] font-bold mt-0.5">{r(pr.val)} ₽</p>
                </div>
              ))}
            </div>
            <div className="mt-2 p-2 bg-orange-50 border border-orange-200 rounded-lg text-center">
              <p className="text-[10px] text-orange-700 font-medium">Маркетплейс (+20% покрытие комиссии)</p>
              <p className="text-[14px] font-bold text-orange-800">{r(calc.priceMarketplace)} ₽</p>
            </div>
          </div>
        </div>
      )}

      {/* Direct costs editor */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Прямые расходы (₽)</p>
          <div className="space-y-1.5">
            {UE_DIRECT_FIELDS.map(({ key, label }) => (
              <div key={key as string} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#6b6b66] flex-1">{label}</span>
                <input
                  type="number"
                  min="0"
                  value={ue[key] as number}
                  onChange={e => update(key, parseFloat(e.target.value) || 0)}
                  className="w-24 border border-[#e4e4e0] rounded px-2 py-1 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e4e4e0]">
              <span className="text-[12px] text-[#6b6b66]">Брак (%)</span>
              <input type="number" min="0" max="20" step="0.5"
                value={ue.cost_defects_pct}
                onChange={e => update('cost_defects_pct', parseFloat(e.target.value) || 0)}
                className="w-24 border border-[#e4e4e0] rounded px-2 py-1 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>
        </div>

        <div>
          <p className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-wider mb-2">Косвенные расходы (%)</p>
          <div className="space-y-1.5">
            {UE_INDIRECT_FIELDS.map(({ key, label }) => (
              <div key={key as string} className="flex items-center justify-between gap-2">
                <span className="text-[12px] text-[#6b6b66] flex-1">{label}</span>
                <input
                  type="number"
                  min="0"
                  max="50"
                  step="0.5"
                  value={ue[key] as number}
                  onChange={e => update(key, parseFloat(e.target.value) || 0)}
                  className="w-20 border border-[#e4e4e0] rounded px-2 py-1 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e4e4e0]">
              <span className="text-[12px] text-[#6b6b66]">CAC (₽)</span>
              <input type="number" min="0"
                value={ue.cac}
                onChange={e => update('cac', parseFloat(e.target.value) || 0)}
                className="w-20 border border-[#e4e4e0] rounded px-2 py-1 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-[#6b6b66]">Цена (override, 0=авто)</span>
              <input type="number" min="0"
                value={ue.price_retail_override}
                onChange={e => update('price_retail_override', parseFloat(e.target.value) || 0)}
                className="w-24 border border-[#e4e4e0] rounded px-2 py-1 text-[12px] text-right focus:outline-none focus:ring-1 focus:ring-blue-300"
              />
            </div>
          </div>

          <button onClick={save} disabled={saving}
            className="mt-4 w-full py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium hover:bg-[#333] disabled:opacity-50 transition-colors">
            {saving ? 'Сохранение...' : 'Сохранить unit-экономику'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── SKU TAB ──────────────────────────────────────────────────────────────────

const SKU_STATUS_STEPS = ['concept', 'development', 'active', 'archived']

function SkuTab() {
  const [skus, setSkus] = useState<Sku[]>([])
  const [lines, setLines] = useState<ProductLine[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [openUE, setOpenUE] = useState<number | null>(null)
  const [openChecklist, setOpenChecklist] = useState<number | null>(null)
  const [checklists, setChecklists] = useState<Record<number, ChecklistItem[]>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({
    sku: '', name: '', category: 'shower', sub_type: '', width_mm: '', height_mm: '',
    color: 'chrome', line_id: '', status: 'concept', notes: '',
  })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const params = new URLSearchParams({ with_ue: 'true' })
    if (filterCat) params.set('category', filterCat)
    if (filterStatus) params.set('status', filterStatus)
    const [skuRes, lineRes] = await Promise.all([
      fetch(`/api/admin/product-skus?${params}`).then(r => r.json()),
      fetch('/api/admin/product-lines').then(r => r.json()),
    ])
    setSkus(Array.isArray(skuRes) ? skuRes : [])
    setLines(Array.isArray(lineRes) ? lineRes : [])
    setLoading(false)
  }, [filterCat, filterStatus])

  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  async function loadChecklist(sku_id: number) {
    if (checklists[sku_id]) return
    const s = await (await fetch(`/api/admin/product-skus?with_checklist=true`)).json()
    // simple load via separate call pattern: GET checklist items
    // For now, fetch from DB directly via product-skus route — we'll handle in API
    // Actually since we didn't build a separate checklist endpoint, let's use a workaround:
    // load directly from supabase client won't work from page. We need to build it.
    // For now just show empty state with a note.
    setChecklists(prev => ({ ...prev, [sku_id]: [] }))
  }

  async function add() {
    if (!form.sku.trim() || !form.name.trim()) return
    setSaving(true)
    const payload = {
      ...form,
      line_id: form.line_id ? parseInt(form.line_id) : null,
      width_mm: form.width_mm ? parseInt(form.width_mm) : null,
      height_mm: form.height_mm ? parseInt(form.height_mm) : null,
    }
    const res = await fetch('/api/admin/product-skus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setShowAdd(false)
      setForm({ sku: '', name: '', category: 'shower', sub_type: '', width_mm: '', height_mm: '', color: 'chrome', line_id: '', status: 'concept', notes: '' })
      load()
    }
    setSaving(false)
  }

  async function nextStatus(sku: Sku) {
    const idx = SKU_STATUS_STEPS.indexOf(sku.status)
    if (idx >= SKU_STATUS_STEPS.length - 1) return
    const status = SKU_STATUS_STEPS[idx + 1]
    await fetch('/api/admin/product-skus', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sku.id, status }),
    })
    setSkus(prev => prev.map(s => s.id === sku.id ? { ...s, status } : s))
  }

  async function del(id: number) {
    await fetch('/api/admin/product-skus', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setSkus(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2 flex-wrap">
          {['', ...Object.keys(CATEGORY_LABELS)].map(cat => (
            <button key={cat} onClick={() => setFilterCat(cat)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${filterCat === cat ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
              {cat ? CATEGORY_LABELS[cat] : 'Все'}
            </button>
          ))}
          {['', ...SKU_STATUS_STEPS].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${filterStatus === s ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#8a8a85]'}`}>
              {s ? STATUS_LABELS[s] : 'Все статусы'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowAdd(v => !v)}
          className="flex-shrink-0 px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium hover:bg-[#333] transition-colors">
          + Добавить SKU
        </button>
      </div>

      {showAdd && (
        <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Новый SKU</p>
          <div className="grid grid-cols-4 gap-3">
            <input placeholder="SKU-код *" value={form.sku}
              onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <input placeholder="Название *" value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="col-span-2 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <input placeholder="Ширина мм" value={form.width_mm}
              onChange={e => setForm(f => ({ ...f, width_mm: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
            <input placeholder="Высота мм" value={form.height_mm}
              onChange={e => setForm(f => ({ ...f, height_mm: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
            <select value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              <option value="chrome">Chrome</option>
              <option value="black">Black</option>
              <option value="brushed_gold">Brushed Gold</option>
              <option value="white">White</option>
            </select>
            <select value={form.line_id} onChange={e => setForm(f => ({ ...f, line_id: e.target.value }))}
              className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
              <option value="">Линейка...</option>
              {lines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <textarea placeholder="Заметки" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
            className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none" />
          <div className="flex gap-2">
            <button onClick={add} disabled={!form.sku.trim() || !form.name.trim() || saving}
              className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium disabled:opacity-50">
              {saving ? 'Создание...' : 'Создать SKU'}
            </button>
            <button onClick={() => setShowAdd(false)}
              className="px-4 py-2 border border-[#e4e4e0] text-[#6b6b66] rounded-xl text-[12px]">
              Отмена
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-[13px] text-[#8a8a85]">Загрузка...</div>
      ) : skus.length === 0 ? (
        <div className="text-center py-12 text-[13px] text-[#8a8a85]">
          SKU нет. Добавьте первый продукт.
        </div>
      ) : (
        <div className="space-y-3">
          {skus.map(sku => {
            const ue = sku.product_unit_economics?.[0]
            const calc = ue ? calcUE(ue) : null
            const isUEOpen = openUE === sku.id
            return (
              <div key={sku.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <div className="px-4 py-3 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[sku.status] ?? 'bg-gray-100'}`}>
                        {STATUS_LABELS[sku.status] ?? sku.status}
                      </span>
                      <span className="text-[10px] font-mono text-[#8a8a85] bg-[#f4f4f0] px-1.5 py-0.5 rounded">
                        {sku.sku}
                      </span>
                      <span className="text-[11px] text-[#8a8a85]">{CATEGORY_LABELS[sku.category] ?? sku.category}</span>
                      {sku.width_mm && sku.height_mm && (
                        <span className="text-[11px] text-[#8a8a85]">{sku.width_mm}×{sku.height_mm} мм</span>
                      )}
                      {sku.color && <span className="text-[11px] text-[#8a8a85]">{sku.color}</span>}
                    </div>
                    <p className="text-[14px] font-semibold text-[#111110]">{sku.name}</p>
                    {calc && (
                      <div className="flex gap-4 mt-1 text-[11px]">
                        <span className="text-[#8a8a85]">
                          Цена: <span className="font-semibold text-[#111110]">{r(calc.retailPrice)} ₽</span>
                        </span>
                        <span className={`font-semibold ${
                          calc.netMarginPct >= 35 ? 'text-green-600' :
                          calc.netMarginPct >= 20 ? 'text-amber-600' : 'text-red-600'
                        }`}>
                          Маржа: {p(calc.netMarginPct)}%
                        </span>
                        <span className="text-[#8a8a85]">
                          Себестоимость: {r(calc.directWithDefects)} ₽
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {sku.status !== 'archived' && (
                      <button onClick={() => nextStatus(sku)}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-[#f4f4f0] text-[#6b6b66] hover:bg-[#e4e4e0]">
                        →
                      </button>
                    )}
                    <button onClick={() => setOpenUE(isUEOpen ? null : sku.id)}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${isUEOpen ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#6b6b66]'}`}>
                      {isUEOpen ? 'Скрыть UE' : 'Unit Economics'}
                    </button>
                    <button onClick={() => del(sku.id)}
                      className="text-[11px] px-2 text-[#c4c4c0] hover:text-red-400">×</button>
                  </div>
                </div>
                {isUEOpen && <div className="px-4 pb-4"><UEPanel sku={sku} /></div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── INFLUENCERS TAB ──────────────────────────────────────────────────────────

const PLATFORM_ICONS: Record<string, string> = {
  instagram: '📷', youtube: '▶️', tiktok: '🎵', telegram: '✈️',
}
const INF_STATUS_LABELS: Record<string, string> = {
  prospect: 'Prospect', contacted: 'Контакт', negotiating: 'Переговоры',
  active: 'Активен', done: 'Завершён', pass: 'Отказ',
}

function InfluencersTab() {
  const [influencers, setInfluencers] = useState<Influencer[]>([])
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'list' | 'campaigns'>('list')
  const [showAdd, setShowAdd] = useState(false)
  const [showCampAdd, setShowCampAdd] = useState(false)
  const [infForm, setInfForm] = useState({
    name: '', platform: 'instagram', handle: '', url: '',
    followers: '', niche: '', er_pct: '', cost_per_post: '', city: '', notes: '',
  })
  const [campForm, setCampForm] = useState({
    influencer_id: '', title: '', campaign_date: '', payment: '', product_cost: '', notes: '',
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/influencers').then(r => r.json()),
      fetch('/api/admin/influencers?type=campaign').then(r => r.json()),
    ]).then(([infs, camps]) => {
      setInfluencers(Array.isArray(infs) ? infs : [])
      setCampaigns(Array.isArray(camps) ? camps : [])
      setLoading(false)
    })
  }, [])

  async function addInfluencer() {
    if (!infForm.name.trim()) return
    setSaving(true)
    const res = await fetch('/api/admin/influencers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...infForm,
        followers: parseInt(infForm.followers) || 0,
        er_pct: parseFloat(infForm.er_pct) || 0,
        cost_per_post: parseFloat(infForm.cost_per_post) || 0,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setInfluencers(prev => [created, ...prev])
      setInfForm({ name: '', platform: 'instagram', handle: '', url: '', followers: '', niche: '', er_pct: '', cost_per_post: '', city: '', notes: '' })
      setShowAdd(false)
    }
    setSaving(false)
  }

  async function addCampaign() {
    if (!campForm.title.trim() || !campForm.influencer_id) return
    setSaving(true)
    const res = await fetch('/api/admin/influencers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        _type: 'campaign',
        ...campForm,
        influencer_id: parseInt(campForm.influencer_id),
        payment: parseFloat(campForm.payment) || 0,
        product_cost: parseFloat(campForm.product_cost) || 0,
      }),
    })
    if (res.ok) {
      const created = await res.json()
      setCampaigns(prev => [created, ...prev])
      setCampForm({ influencer_id: '', title: '', campaign_date: '', payment: '', product_cost: '', notes: '' })
      setShowCampAdd(false)
    }
    setSaving(false)
  }

  async function updateInfStatus(id: number, status: string) {
    await fetch('/api/admin/influencers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setInfluencers(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }

  async function updateCampResult(id: number, fields: Partial<Campaign>) {
    await fetch('/api/admin/influencers', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, _type: 'campaign', ...fields }),
    })
    setCampaigns(prev => prev.map(c => c.id === id ? { ...c, ...fields } : c))
  }

  // Stats
  const totalSpend = campaigns.reduce((a, c) => a + c.payment + c.product_cost, 0)
  const totalRevenue = campaigns.reduce((a, c) => a + c.revenue, 0)
  const totalLeads = campaigns.reduce((a, c) => a + c.leads, 0)
  const totalViews = campaigns.reduce((a, c) => a + c.views, 0)
  const romi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend * 100) : 0

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Блогеров', value: influencers.length },
          { label: 'Просмотры', value: totalViews.toLocaleString('ru') },
          { label: 'Лиды', value: totalLeads },
          { label: 'ROMI', value: `${romi > 0 ? '+' : ''}${Math.round(romi)}%` },
        ].map(s => (
          <div key={s.label} className="bg-white border border-[#e4e4e0] rounded-xl p-4 text-center">
            <p className="text-[11px] text-[#8a8a85] uppercase tracking-wider">{s.label}</p>
            <p className="text-[22px] font-bold text-[#111110] mt-1">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-[#f4f4f0] rounded-xl p-1">
        {([['list', 'Блогеры'], ['campaigns', 'Кампании']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${tab === k ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66]'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAdd(v => !v)}
              className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium hover:bg-[#333] transition-colors">
              + Добавить блогера
            </button>
          </div>

          {showAdd && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-3">
              <p className="text-[13px] font-semibold text-[#111110]">Новый блогер</p>
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="Имя *" value={infForm.name}
                  onChange={e => setInfForm(f => ({ ...f, name: e.target.value }))}
                  className="col-span-2 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
                <select value={infForm.platform} onChange={e => setInfForm(f => ({ ...f, platform: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
                  {Object.entries(PLATFORM_ICONS).map(([k, v]) => <option key={k} value={k}>{v} {k}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <input placeholder="@handle" value={infForm.handle}
                  onChange={e => setInfForm(f => ({ ...f, handle: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Подписчики" value={infForm.followers}
                  onChange={e => setInfForm(f => ({ ...f, followers: e.target.value }))} type="number"
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="ER %" value={infForm.er_pct}
                  onChange={e => setInfForm(f => ({ ...f, er_pct: e.target.value }))} type="number" step="0.1"
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Стоимость поста ₽" value={infForm.cost_per_post}
                  onChange={e => setInfForm(f => ({ ...f, cost_per_post: e.target.value }))} type="number"
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input placeholder="Ниша" value={infForm.niche}
                  onChange={e => setInfForm(f => ({ ...f, niche: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Город" value={infForm.city}
                  onChange={e => setInfForm(f => ({ ...f, city: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Ссылка профиля" value={infForm.url}
                  onChange={e => setInfForm(f => ({ ...f, url: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={addInfluencer} disabled={!infForm.name.trim() || saving}
                  className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] disabled:opacity-50">
                  {saving ? 'Сохранение...' : 'Добавить'}
                </button>
                <button onClick={() => setShowAdd(false)}
                  className="px-4 py-2 border border-[#e4e4e0] text-[#6b6b66] rounded-xl text-[12px]">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-[13px] text-[#8a8a85]">Загрузка...</div>
          ) : influencers.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-[#8a8a85]">Блогеров нет. Добавьте первого.</div>
          ) : (
            <div className="space-y-2">
              {influencers.map(inf => (
                <div key={inf.id} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 flex items-center gap-4">
                  <span className="text-[20px]">{PLATFORM_ICONS[inf.platform] ?? '👤'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-[13px] font-semibold text-[#111110]">{inf.name}</p>
                      {inf.handle && <span className="text-[11px] text-[#8a8a85]">@{inf.handle}</span>}
                      {inf.niche && <span className="text-[11px] text-[#8a8a85]">· {inf.niche}</span>}
                      {inf.city && <span className="text-[11px] text-[#8a8a85]">· {inf.city}</span>}
                    </div>
                    <div className="flex gap-4 text-[11px] text-[#6b6b66]">
                      <span>{inf.followers.toLocaleString('ru')} подп.</span>
                      {inf.er_pct > 0 && <span>ER {inf.er_pct}%</span>}
                      {inf.cost_per_post > 0 && <span>{r(inf.cost_per_post)} ₽/пост</span>}
                    </div>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    {Object.entries(INF_STATUS_LABELS).map(([s, sl]) => (
                      <button key={s} onClick={() => updateInfStatus(inf.id, s)}
                        className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                          inf.status === s
                            ? (INF_STATUS_COLORS[s] ?? 'bg-gray-100 text-gray-600') + ' font-semibold'
                            : 'bg-[#f4f4f0] text-[#8a8a85]'
                        }`}>
                        {sl}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'campaigns' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowCampAdd(v => !v)}
              className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] font-medium hover:bg-[#333] transition-colors">
              + Добавить кампанию
            </button>
          </div>

          {showCampAdd && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-5 space-y-3">
              <p className="text-[13px] font-semibold text-[#111110]">Новая кампания</p>
              <div className="grid grid-cols-3 gap-3">
                <select value={campForm.influencer_id} onChange={e => setCampForm(f => ({ ...f, influencer_id: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none">
                  <option value="">Блогер *</option>
                  {influencers.map(i => <option key={i.id} value={i.id}>{PLATFORM_ICONS[i.platform]} {i.name}</option>)}
                </select>
                <input placeholder="Название кампании *" value={campForm.title}
                  onChange={e => setCampForm(f => ({ ...f, title: e.target.value }))}
                  className="col-span-2 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <input type="date" value={campForm.campaign_date}
                  onChange={e => setCampForm(f => ({ ...f, campaign_date: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Оплата ₽" value={campForm.payment} type="number"
                  onChange={e => setCampForm(f => ({ ...f, payment: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
                <input placeholder="Стоимость изделия ₽" value={campForm.product_cost} type="number"
                  onChange={e => setCampForm(f => ({ ...f, product_cost: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] focus:outline-none" />
              </div>
              <div className="flex gap-2">
                <button onClick={addCampaign} disabled={!campForm.title.trim() || !campForm.influencer_id || saving}
                  className="px-4 py-2 bg-[#111110] text-white rounded-xl text-[12px] disabled:opacity-50">
                  {saving ? 'Сохранение...' : 'Создать'}
                </button>
                <button onClick={() => setShowCampAdd(false)}
                  className="px-4 py-2 border border-[#e4e4e0] text-[#6b6b66] rounded-xl text-[12px]">
                  Отмена
                </button>
              </div>
            </div>
          )}

          {campaigns.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-[#8a8a85]">Кампаний нет.</div>
          ) : (
            <div className="space-y-2">
              {campaigns.map(c => {
                const totalCost = c.payment + c.product_cost
                const roi = totalCost > 0 ? ((c.revenue - totalCost) / totalCost * 100) : 0
                const campInf = (c as unknown as { influencers?: { name: string; platform: string } }).influencers
                return (
                  <div key={c.id} className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className="text-[13px] font-semibold text-[#111110]">{c.title}</p>
                          {campInf && (
                            <span className="text-[11px] text-[#8a8a85]">
                              {PLATFORM_ICONS[campInf.platform] ?? '👤'} {campInf.name}
                            </span>
                          )}
                          {c.campaign_date && (
                            <span className="text-[11px] text-[#8a8a85]">{new Date(c.campaign_date).toLocaleDateString('ru')}</span>
                          )}
                        </div>
                        <div className="flex gap-4 text-[11px]">
                          <span className="text-[#6b6b66]">Бюджет: {r(totalCost)} ₽</span>
                          <span className="text-[#6b6b66]">Просмотры: {c.views.toLocaleString('ru')}</span>
                          <span className="text-[#6b6b66]">Лиды: {c.leads}</span>
                          <span className="text-[#6b6b66]">Заказы: {c.orders}</span>
                          <span className="text-[#6b6b66]">Выручка: {r(c.revenue)} ₽</span>
                          <span className={`font-semibold ${roi >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            ROI: {roi >= 0 ? '+' : ''}{Math.round(roi)}%
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Results inline edit */}
                    <div className="flex gap-2 mt-2">
                      {([
                        { key: 'views', label: '👁' }, { key: 'leads', label: '🎯' },
                        { key: 'orders', label: '📦' }, { key: 'revenue', label: '₽' },
                      ] as { key: keyof Campaign; label: string }[]).map(({ key, label }) => (
                        <label key={key as string} className="flex items-center gap-1 text-[11px]">
                          <span className="text-[#8a8a85]">{label}</span>
                          <input type="number" min="0"
                            defaultValue={c[key] as number}
                            onBlur={e => updateCampResult(c.id, { [key]: parseFloat(e.target.value) || 0 })}
                            className="w-20 border border-[#e4e4e0] rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── MAIN PAGE ────────────────────────────────────────────────────────────────

type Tab = 'strategy' | 'matrix' | 'skus' | 'influencers'

const TABS: { key: Tab; label: string }[] = [
  { key: 'strategy',    label: 'Стратегия' },
  { key: 'matrix',      label: 'Матрица линеек' },
  { key: 'skus',        label: 'SKU + Unit Economics' },
  { key: 'influencers', label: 'Инфлюенсеры' },
]

export default function ProductLinePage() {
  const [tab, setTab] = useState<Tab>('strategy')

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px] px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-semibold uppercase tracking-wider">
            Admin only
          </span>
          <span className="text-[11px] text-[#8a8a85]">Product Line Center</span>
        </div>
        <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">Product Line</h1>
        <p className="text-[13px] text-[#6b6b66] mt-0.5">
          Стратегический центр развития продуктовой линейки MGlass — от кастома к масштабируемому product brand
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-[#f4f4f0] rounded-xl p-1">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 rounded-lg text-[12px] font-medium transition-colors ${
              tab === t.key ? 'bg-white text-[#111110] shadow-sm' : 'text-[#6b6b66] hover:text-[#111110]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'strategy'    && <StrategyTab />}
      {tab === 'matrix'      && <MatrixTab />}
      {tab === 'skus'        && <SkuTab />}
      {tab === 'influencers' && <InfluencersTab />}
    </div>
  )
}
