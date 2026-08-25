'use client'

import { useEffect, useMemo, useState } from 'react'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import { FINISHES } from '@/lib/configurator/catalog'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type GlassTint } from '@/components/configurator/scene/assembly'
import {
  computeQuantities, computePrice, supplierColorToFinish,
  GLASS_TYPE_IDS, DEFAULT_FINANCE,
  type Tier, type UnitPrices, type HardwareGroup, type PieceItem, type BarItem,
} from '@/lib/configurator/pricing'

// ── Пикер из справочника поставщиков ──────────────────────────────
type PickRow = { id: number; supplier: string; category: string; name: string; color: string; cost_price: number; retail_price: number; is_favorite: boolean }
type PickSource = { supplier: string; title: string; discount_percent: number }
type CompareRow = { id: number; supplier: string; name: string; color: string; cost_price: number }

function CatalogPicker({ onPick, onClose }: { onPick: (id: number) => void; onClose: () => void }) {
  const [supplier, setSupplier] = useState('all')
  const [q, setQ] = useState('')
  const [qd, setQd] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [rows, setRows] = useState<PickRow[]>([])
  const [sources, setSources] = useState<PickSource[]>([])
  const [total, setTotal] = useState(0)
  const [favTotal, setFavTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [compareId, setCompareId] = useState<number | null>(null)
  const [compare, setCompare] = useState<{ cheapest: number | null; matches: CompareRow[] } | null>(null)

  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    setLoading(true)
    const p = new URLSearchParams({ supplier, q: qd, page: '0' })
    if (favOnly) p.set('favorites', '1')
    fetch(`/api/admin/supplier-catalog?${p}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setRows(d.rows); setSources(d.sources); setTotal(d.total); setFavTotal(d.favTotal ?? 0) }
    }).finally(() => setLoading(false))
  }, [supplier, qd, favOnly])

  const title = (s: string) => sources.find(x => x.supplier === s)?.title ?? s

  const toggleFav = (r: PickRow) => {
    const next = !r.is_favorite
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, is_favorite: next } : x))
    setFavTotal(t => t + (next ? 1 : -1))
    fetch('/api/admin/supplier-catalog/favorite', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: r.id, favorite: next }),
    }).catch(() => {})
  }
  const openCompare = (id: number) => {
    if (compareId === id) { setCompareId(null); setCompare(null); return }
    setCompareId(id); setCompare(null)
    fetch(`/api/admin/supplier-catalog/compare?id=${id}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setCompare({ cheapest: d.cheapest, matches: d.matches })
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 pt-16" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[720px] max-h-[80vh] flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-[#e4e4e0]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[15px] font-semibold text-[#111110]">Из справочника поставщиков</p>
            <button onClick={onClose} className="text-[#9a9a95] hover:text-[#111110] text-[18px] leading-none">×</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button onClick={() => setSupplier('all')} className={`px-3 py-1 rounded-md text-[12px] font-medium border ${supplier === 'all' ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>Все</button>
            {sources.map(s => (
              <button key={s.supplier} onClick={() => setSupplier(s.supplier)} className={`px-3 py-1 rounded-md text-[12px] font-medium border ${supplier === s.supplier ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>{s.title} −{s.discount_percent}%</button>
            ))}
            <button onClick={() => setFavOnly(v => !v)} className={`px-3 py-1 rounded-md text-[12px] font-medium border ml-auto ${favOnly ? 'bg-[#a06a00] text-white border-[#a06a00]' : 'bg-white text-[#a06a00] border-[#e4d9c0]'}`}>★ Наши позиции{favTotal ? ` (${favTotal})` : ''}</button>
          </div>
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск: название или артикул (напр. «петля 180», «труба 30х10»)…"
            className="w-full text-[13px] border border-[#e4e4e0] rounded-lg px-3 py-2 focus:border-[#111110] outline-none" />
        </div>
        <div className="overflow-auto p-2">
          {loading && <p className="text-[13px] text-[#9a9a95] px-2 py-3">Загрузка…</p>}
          {!loading && rows.length === 0 && <p className="text-[13px] text-[#9a9a95] px-2 py-3">{favOnly ? 'В «наших позициях» пусто — отметь нужные звёздочкой' : 'Ничего не найдено'}</p>}
          {rows.map(r => (
            <div key={r.id}>
              <div className="w-full px-2 py-2 rounded-lg hover:bg-[#f5f5f3] flex items-center gap-2">
                <button onClick={() => toggleFav(r)} title={r.is_favorite ? 'Убрать из наших позиций' : 'Отметить как нашу позицию'}
                  className={`text-[15px] leading-none shrink-0 ${r.is_favorite ? 'text-[#e0a200]' : 'text-[#d0d0cc] hover:text-[#e0a200]'}`}>{r.is_favorite ? '★' : '☆'}</button>
                <button onClick={() => onPick(r.id)} className="flex-1 min-w-0 text-left">
                  <span className="block text-[13px] text-[#111110] truncate">{r.name}</span>
                  <span className="block text-[11px] text-[#9a9a95]">{title(r.supplier)} · {r.color || '—'}</span>
                </button>
                <button onClick={() => openCompare(r.id)} title="Сравнить у поставщиков"
                  className={`text-[13px] leading-none shrink-0 px-1 ${compareId === r.id ? 'text-[#111110]' : 'text-[#9a9a95] hover:text-[#111110]'}`}>⇄</button>
                <span className="font-mono text-[13px] font-semibold text-[#111110] shrink-0 w-[76px] text-right">{Math.round(r.cost_price).toLocaleString('ru-RU')} ₽</span>
              </div>
              {compareId === r.id && (
                <div className="ml-7 mr-1 mb-1.5 rounded-lg bg-[#faf9f6] border border-[#eeece5] p-2">
                  {!compare && <p className="text-[11px] text-[#9a9a95] px-1 py-1">Ищем у других поставщиков…</p>}
                  {compare && compare.matches.length === 0 && <p className="text-[11px] text-[#9a9a95] px-1 py-1">Похожих позиций у других поставщиков нет</p>}
                  {compare && compare.matches.map(m => {
                    const isCheapest = m.cost_price === compare.cheapest
                    return (
                      <button key={m.id} onClick={() => onPick(m.id)}
                        className="w-full text-left flex items-center gap-2 px-2 py-1 rounded-md hover:bg-white">
                        <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${isCheapest ? 'bg-[#256029] text-white' : 'bg-[#eceae2] text-[#6b6b63]'}`}>{title(m.supplier)}</span>
                        <span className="flex-1 min-w-0 text-[11px] text-[#6b6b63] truncate">{m.color || '—'}</span>
                        {isCheapest && <span className="text-[10px] text-[#256029] font-semibold shrink-0">дешевле</span>}
                        <span className="font-mono text-[12px] font-semibold text-[#111110] shrink-0">{Math.round(m.cost_price).toLocaleString('ru-RU')} ₽</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
          {!loading && total > rows.length && <p className="text-[11px] text-[#9a9a95] px-3 py-2">Показаны первые {rows.length} из {total} — уточни поиск</p>}
        </div>
        <div className="p-3 border-t border-[#e4e4e0] text-[11px] text-[#9a9a95]">
          ★ — «наши позиции» (что реально закупаем), всегда наверху. ⇄ — сравнить цену у поставщиков. Выбор заполнит себестоимость по всем цветам, скидка учтена.
        </div>
      </div>
    </div>
  )
}

const GLASS_LABEL: Record<string, string> = {
  clear: 'Прозрачное М1', crystal: 'Осветлённое Crystal Vision', bronze: 'Тонированная бронза', graphite: 'Тонированная графит',
}
const TINT: Record<string, GlassTint> = {
  clear: { color: '#dcebe0', attenuation: '#a3c6ab', distance: 1.35 },
  crystal: { color: '#e9f2fb', attenuation: '#c4daef', distance: 3.2 },
  bronze: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 },
  graphite: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 },
}
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
const uid = (p: string) => `${p}-${Math.round(Math.random() * 1e9).toString(36)}`

function NumInput({ value, onChange, w = 96, suffix = '₽' }: { value: number; onChange: (v: number) => void; w?: number; suffix?: string }) {
  return (
    <span className="flex items-center gap-1">
      <input type="number" value={value} onChange={e => onChange(Number(e.target.value) || 0)} style={{ width: w }}
        className="text-right font-mono text-[13px] text-[#111110] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
      <span className="text-[11px] text-[#9a9a95]">{suffix}</span>
    </span>
  )
}
function Card({ title, right, children }: { title?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      {title && <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">{title}</p>{right}
      </div>}
      {children}
    </div>
  )
}

export function VisualizerPricingClient({ initial }: { initial: Record<Tier, UnitPrices> }) {
  const [tier, setTier] = useState<Tier>('budget')
  const [prices, setPrices] = useState<Record<Tier, UnitPrices>>(initial)
  const [code, setCode] = useState('М7')
  const [glassType, setGlassType] = useState('clear')
  const [finishId, setFinishId] = useState('chrome')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const up = prices[tier]
  const model = getModel(code)
  const dims = useMemo(() => {
    const c = model.constraints
    const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
    return {
      width: mid(c.width), height: Math.min(2000, c.height[1]),
      width2: c.needsWidth2 && c.width2 ? mid(c.width2) : undefined,
      doorWidth: c.doorWidth ? 600 : undefined,
    }
  }, [model])

  const assembly = useMemo(() => buildFromModel(model, dims, 8), [model, dims])
  const q = useMemo(() => computeQuantities(assembly, 8), [assembly])
  const price = useMemo(() => computePrice(q, up, DEFAULT_FINANCE, { glassType, finishId }), [q, up, glassType, finishId])

  function edit(mutate: (u: UnitPrices) => void) {
    setPrices(prev => {
      const next = structuredClone(prev)
      mutate(next[tier])
      return next
    })
    setDirty(true); setMsg(null)
  }

  // Заполнить текущий тариф группами из другого (стартовая точка, дальше правишь цены).
  function copyFromOtherTier() {
    const other: Tier = tier === 'budget' ? 'premium' : 'budget'
    setPrices(prev => {
      const next = structuredClone(prev)
      next[tier] = { ...next[tier], groups: structuredClone(prev[other].groups) }
      return next
    })
    setDirty(true); setMsg(null)
  }

  // ── мутаторы подгрупп/позиций ──
  const setGroupTitle = (gi: number, title: string) => edit(u => { u.groups[gi].title = title })
  const removeGroup = (gi: number) => edit(u => { u.groups.splice(gi, 1) })
  const addGroup = (kind: 'piece' | 'bar') => edit(u => {
    if (kind === 'piece') u.groups.push({ id: uid('grp'), title: 'Новая подгруппа', kind: 'piece', items: [] })
    else u.groups.push({ id: uid('grp'), title: 'Новая подгруппа (хлысты)', kind: 'bar', items: [] })
  })
  const addItem = (gi: number) => edit(u => {
    const g = u.groups[gi]
    if (g.kind === 'piece') g.items.push({ key: uid('it'), name: 'Новая позиция', prices: {}, qtyMode: 'manual', fixedQty: 1 })
    else g.items.push({ key: uid('it'), name: 'Новый профиль/штанга', stocks: [{ len: 2200, prices: {} }] })
  })
  const removeItem = (gi: number, ii: number) => edit(u => { (u.groups[gi].items as unknown[]).splice(ii, 1) })
  const setItemName = (gi: number, ii: number, name: string) => edit(u => { u.groups[gi].items[ii].name = name })
  const setPiecePrice = (gi: number, ii: number, v: number) => edit(u => {
    const it = u.groups[gi].items[ii] as PieceItem; it.prices = { ...it.prices, [finishId]: v }
  })
  const setPieceQty = (gi: number, ii: number, v: number) => edit(u => {
    const it = u.groups[gi].items[ii] as PieceItem; it.fixedQty = v
  })
  const setBarLen = (gi: number, ii: number, si: number, v: number) => edit(u => { (u.groups[gi].items[ii] as BarItem).stocks[si].len = v })
  const setBarPrice = (gi: number, ii: number, si: number, v: number) => edit(u => {
    const st = (u.groups[gi].items[ii] as BarItem).stocks[si]; st.prices = { ...st.prices, [finishId]: v }
  })
  const addBarStock = (gi: number, ii: number) => edit(u => { (u.groups[gi].items[ii] as BarItem).stocks.push({ len: 0, prices: {} }) })
  const removeBarStock = (gi: number, ii: number, si: number) => edit(u => { (u.groups[gi].items[ii] as BarItem).stocks.splice(si, 1) })

  // ── Пикер справочника: выбрал позицию → тянем все цвета → заполняем/добавляем ──
  type Target =
    | { mode: 'fill-piece'; gi: number; ii: number }
    | { mode: 'fill-bar'; gi: number; ii: number; si: number }
    | { mode: 'add-piece'; gi: number }
    | { mode: 'add-bar'; gi: number }
  const [picker, setPicker] = useState<Target | null>(null)
  const parseBarLen = (name: string): number => {
    const m = name.replace(',', '.').match(/(\d+(?:\.\d+)?)\s*м(?![а-яё])/i)  // «3 м», «2.2 м»
    return m ? Math.round(parseFloat(m[1]) * 1000) : 3000
  }
  async function applyPick(rowId: number) {
    const target = picker
    setPicker(null)
    if (!target) return
    const res = await fetch(`/api/admin/supplier-catalog/variants?id=${rowId}`)
    if (!res.ok) return
    const { variants, name, supplier, base } = await res.json() as {
      variants: { color: string; cost_price: number }[]; name: string; supplier: string; base: string
    }
    const byFinish: Record<string, number> = {}
    for (const v of variants) {
      const f = supplierColorToFinish(v.color)
      if (f && !(f in byFinish)) byFinish[f] = Math.round(v.cost_price)
    }
    if (Object.keys(byFinish).length === 0 && variants.length) byFinish[finishId] = Math.round(variants[0].cost_price)
    const label = name.length > 60 ? name.slice(0, 60) + '…' : name
    const shortName = name.split('.')[0].slice(0, 48)
    edit(u => {
      const g = u.groups[target.gi]
      if (target.mode === 'fill-piece') {
        const it = g.items[target.ii] as PieceItem
        it.prices = { ...it.prices, ...byFinish }; it.ref = { supplier, base, label }
      } else if (target.mode === 'fill-bar') {
        const st = (g.items[target.ii] as BarItem).stocks[target.si]
        st.prices = { ...st.prices, ...byFinish }
      } else if (target.mode === 'add-piece' && g.kind === 'piece') {
        g.items.push({ key: uid('it'), name: shortName, prices: byFinish, qtyMode: 'auto', ref: { supplier, base, label } })
      } else if (target.mode === 'add-bar' && g.kind === 'bar') {
        // ключ = роль подгруппы (profile/tube) — чтобы длины кусков пришли из геометрии
        g.items.push({ key: g.role ?? uid('it'), name: shortName, stocks: [{ len: parseBarLen(name), prices: byFinish }] })
      }
    })
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/configurator-pricing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, data: prices[tier] }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка сохранения')
      setDirty(false); setMsg('Сохранено')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
    finally { setSaving(false) }
  }

  const colorLabel = FINISHES.find(f => f.id === finishId)?.label ?? finishId

  return (
    <div className="max-w-[1320px] mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Себестоимость визуализатора</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Цены по тарифу. Меняешь здесь → сразу в расчёте у клиента.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-[13px] ${msg === 'Сохранено' ? 'text-[#256029]' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={save} disabled={!dirty || saving}
            className={`text-[13px] font-medium px-4 py-2 rounded-lg ${dirty && !saving ? 'bg-[#111110] text-white hover:bg-[#2a2a28]' : 'bg-[#eee] text-[#9a9a95]'}`}>
            {saving ? 'Сохраняю…' : `Сохранить ${tier === 'budget' ? 'Бюджет' : 'Премиум'}`}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="inline-flex rounded-lg border border-[#e4e4e0] overflow-hidden text-[13px] font-medium">
          <button onClick={() => setTier('budget')} className={`px-5 py-2 ${tier === 'budget' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Бюджет</button>
          <button onClick={() => setTier('premium')} className={`px-5 py-2 ${tier === 'premium' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Премиум</button>
        </div>
        <button onClick={() => copyFromOtherTier()}
          className="text-[12px] text-[#4b6ea9] hover:underline">↳ Заполнить из «{tier === 'budget' ? 'Премиум' : 'Бюджет'}»</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[210px_1fr_380px] gap-5 items-start">
        {/* Модели */}
        <div className="grid gap-1.5 lg:sticky lg:top-4">
          {M_MODELS.map(m => (
            <button key={m.code} onClick={() => setCode(m.code)}
              className={`text-left px-3 py-2 rounded-lg text-[13px] border ${code === m.code ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
              <span className="font-mono">{m.code}</span> · {m.name}
            </button>
          ))}
        </div>

        {/* 3D + спецификация модели + расчёт */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-3">
            <Partition3DView model={model} dims={dims} thickness={8} finishHex={FINISHES.find(f => f.id === finishId)?.hex ?? '#c9ccd0'} finishId={finishId} glassTint={TINT[glassType]} />
          </div>
          <Card title={`Спецификация ${model.code} · ${colorLabel}`}>
            {price.missing.length > 0 ? (
              <div className="mb-2 rounded-lg bg-[#fdf3ec] border border-[#f0d9c4] px-3 py-2 text-[12px] text-[#9a5a2a]">
                ⚠️ Для {model.code} не заполнено: <b>{price.missing.map(m => m.title).join(', ')}</b>. Добавь позицию в подгруппу → расчёт станет полным.
              </div>
            ) : (
              <div className="mb-2 rounded-lg bg-[#f0f7f0] border border-[#cfe6cf] px-3 py-2 text-[12px] text-[#256029]">✅ Комплект полный для {model.code} · {colorLabel}</div>
            )}
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Стекло {GLASS_LABEL[glassType]}</span><span className="font-mono">{q.glassM2} м² · {rub(price.glassCost)}</span></div>
            {price.groupedLines.map(g => (
              <div key={g.id} className="mt-1.5">
                <p className="text-[11px] uppercase tracking-wide text-[#a0a09a]">{g.title}</p>
                {g.lines.map(l => (
                  <div key={l.key} className="flex justify-between text-[13px] py-0.5">
                    <span className="text-[#4b4b47]">{l.label}</span>
                    <span className="font-mono">{l.unit === 'м.п.' ? `${l.qty} м.п.` : `${l.qty}×${rub(l.unitPrice)}`} = {rub(l.total)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div className="flex justify-between text-[13px] pt-2 mt-1 border-t border-[#f0f0ec]"><span className="text-[#6b6b66]">Себестоимость</span><span className="font-mono">{rub(price.materialsCost)}</span></div>
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Цена изделия ({price.marginPct}/{price.taxPct}%)</span><span className="font-mono">{rub(price.itemPrice)}</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#4b4b47]">Монтаж {q.sections}×{rub(up.installPerSection)} + доставка</span><span className="font-mono">{rub(price.installCost + price.deliveryCost)}</span></div>
            <div className="flex justify-between text-[14px] font-semibold pt-1"><span>Сумма изделия</span><span className="font-mono">{rub(price.total)}</span></div>
          </Card>
        </div>

        {/* Редактор цен тарифа */}
        <div className="space-y-3">
          <Card title="Стекло · ₽/м²">
            {GLASS_TYPE_IDS.map(g => (
              <label key={g} className="flex items-center justify-between gap-2 text-[13px] py-0.5">
                <span className="text-[#4b4b47]">{GLASS_LABEL[g]}</span>
                <NumInput value={up.glassPerM2[g] ?? 0} onChange={v => edit(u => { u.glassPerM2[g] = v })} suffix="₽/м²" />
              </label>
            ))}
            <p className="text-[11px] text-[#9a9a95] mt-1">Тип для превью: {GLASS_TYPE_IDS.map(g => (
              <button key={g} onClick={() => setGlassType(g)} className={`ml-1 underline ${glassType === g ? 'text-[#111110] font-semibold' : ''}`}>{GLASS_LABEL[g].split(' ')[0]}</button>
            ))}</p>
          </Card>

          {/* Цвет фурнитуры — общий для всех подгрупп */}
          <Card title="Цвет фурнитуры">
            <div className="flex flex-wrap gap-1.5">
              {FINISHES.map(f => (
                <button key={f.id} onClick={() => setFinishId(f.id)} title={f.label}
                  className={`w-7 h-7 rounded-md border-2 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`} style={{ background: f.hex }} />
              ))}
            </div>
            <p className="text-[12px] text-[#6b6b66] mt-1.5">Цены ниже — для цвета <b className="text-[#111110]">{colorLabel}</b>.</p>
          </Card>

          {/* Подгруппы фурнитуры — позиции тянутся из справочника, кол-во из модели */}
          {up.groups.map((g: HardwareGroup, gi: number) => {
            const roleQty = g.role ? (q.roles[g.role] ?? 0) : 0
            return (
            <Card key={g.id}
              right={<button onClick={() => removeGroup(gi)} className="text-[11px] text-[#b04a3f] hover:underline">удалить</button>}>
              <div className="flex items-center gap-2 mb-2 -mt-1">
                <input value={g.title} onChange={e => setGroupTitle(gi, e.target.value)}
                  className="flex-1 text-[13px] font-semibold text-[#111110] border-b border-transparent hover:border-[#e4e4e0] focus:border-[#111110] outline-none py-0.5" />
                {g.kind === 'piece' && g.role
                  ? <span className="text-[10px] text-[#8a9a7a]">×{roleQty} из модели</span>
                  : <span className="text-[10px] text-[#9a9a95] uppercase">{g.kind === 'bar' ? 'хлысты' : 'шт'}</span>}
              </div>
              {g.items.length === 0 && (
                <p className="text-[12px] text-[#b0b0aa] italic py-1">Пусто — добавь позицию из справочника ↓</p>
              )}
              {g.kind === 'piece' ? (g.items as PieceItem[]).map((it, ii) => (
                <div key={it.key} className="py-0.5">
                  <div className="flex items-center gap-1.5">
                    <input value={it.name} onChange={e => setItemName(gi, ii, e.target.value)}
                      className="flex-1 min-w-0 text-[13px] text-[#4b4b47] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
                    {it.qtyMode === 'manual'
                      ? <NumInput value={it.fixedQty ?? 0} onChange={v => setPieceQty(gi, ii, v)} w={44} suffix="шт" />
                      : <span className="text-[11px] text-[#9a9a95] w-12 text-right">{ii === 0 ? `×${roleQty}` : 'запас'}</span>}
                    <NumInput value={it.prices[finishId] ?? 0} onChange={v => setPiecePrice(gi, ii, v)} w={80} />
                    <button onClick={() => setPicker({ mode: 'fill-piece', gi, ii })} title="Обновить цену из справочника" className="text-[13px] leading-none px-0.5 hover:opacity-70">📗</button>
                    <button onClick={() => removeItem(gi, ii)} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-1">×</button>
                  </div>
                  {it.ref && <p className="text-[10px] text-[#8a9a7a] pl-1.5 truncate">🔗 {it.ref.label ?? it.ref.base}</p>}
                </div>
              )) : (g.items as BarItem[]).map((it, ii) => (
                <div key={it.key} className="py-1 border-b border-[#f4f4f0] last:border-0">
                  <div className="flex items-center gap-1.5">
                    <input value={it.name} onChange={e => setItemName(gi, ii, e.target.value)}
                      className="flex-1 min-w-0 text-[13px] font-medium text-[#4b4b47] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
                    <button onClick={() => removeItem(gi, ii)} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-1">×</button>
                  </div>
                  {it.stocks.map((s, si) => (
                    <div key={si} className="flex items-center gap-1.5 py-0.5 pl-2">
                      <span className="text-[11px] text-[#9a9a95] w-10">Хлыст</span>
                      <NumInput value={s.len} onChange={v => setBarLen(gi, ii, si, v)} w={64} suffix="мм" />
                      <NumInput value={s.prices[finishId] ?? 0} onChange={v => setBarPrice(gi, ii, si, v)} w={80} />
                      <button onClick={() => setPicker({ mode: 'fill-bar', gi, ii, si })} title="Цена из справочника" className="text-[13px] leading-none px-0.5 hover:opacity-70">📗</button>
                      <button onClick={() => removeBarStock(gi, ii, si)} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-1">×</button>
                    </div>
                  ))}
                  <button onClick={() => addBarStock(gi, ii)} className="text-[12px] text-[#4b6ea9] hover:underline ml-2 mt-0.5">+ хлыст</button>
                </div>
              ))}
              <div className="flex gap-3 mt-1.5">
                <button onClick={() => setPicker(g.kind === 'piece' ? { mode: 'add-piece', gi } : { mode: 'add-bar', gi })}
                  className="text-[12px] font-medium text-[#256029] hover:underline">📗 из справочника</button>
                <button onClick={() => addItem(gi)} className="text-[12px] text-[#9a9a95] hover:underline">+ вручную</button>
              </div>
            </Card>
          )})}

          <div className="flex gap-2">
            <button onClick={() => addGroup('piece')} className="flex-1 text-[13px] font-medium border border-dashed border-[#c4c4be] rounded-lg py-2 text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">+ Подгруппа</button>
            <button onClick={() => addGroup('bar')} className="flex-1 text-[13px] font-medium border border-dashed border-[#c4c4be] rounded-lg py-2 text-[#4b4b47] hover:border-[#111110] hover:text-[#111110]">+ Подгруппа (хлысты)</button>
          </div>

          <Card title="Работы и логистика">
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Монтаж за секцию</span><NumInput value={up.installPerSection} onChange={v => edit(u => { u.installPerSection = v })} /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Доставка Москва</span><NumInput value={up.deliveryMoscow} onChange={v => edit(u => { u.deliveryMoscow = v })} /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Подъём за этаж</span><NumInput value={up.liftPerFloor} onChange={v => edit(u => { u.liftPerFloor = v })} /></label>
          </Card>
        </div>
      </div>

      {picker && <CatalogPicker onPick={applyPick} onClose={() => setPicker(null)} />}
    </div>
  )
}
