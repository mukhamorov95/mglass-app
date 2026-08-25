'use client'

import { useEffect, useMemo, useState } from 'react'
import type { InventoryItem, Contour, Kind } from '@/lib/inventory/types'
import { KIND_LABELS, stockStatus } from '@/lib/inventory/units'
import { INPUT, BTN, BTN_P, CARD, api, money, CONTOUR_TABS, KIND_ORDER, type ItemsResponse, type Summary } from './shared'
import StockTab from './StockTab'
import ReceiveTab from './ReceiveTab'
import CountTab from './CountTab'
import ConsumeTab from './ConsumeTab'
import MovesTab from './MovesTab'
import ItemDialog from './ItemDialog'
import CatalogDialog from './CatalogDialog'

type Tab = 'stock' | 'receive' | 'count' | 'consume' | 'moves'

const TABS: { v: Tab; l: string }[] = [
  { v: 'stock',   l: 'Остатки' },
  { v: 'receive', l: 'Приход' },
  { v: 'count',   l: 'Инвентаризация' },
  { v: 'consume', l: 'Списание по заказам' },
  { v: 'moves',   l: 'Движения' },
]

// Ссылка вида /inventory?tab=receive открывает нужную вкладку (из «Закупок»).
function initialTab(): Tab {
  if (typeof window === 'undefined') return 'stock'
  const t = new URLSearchParams(window.location.search).get('tab')
  return TABS.some(x => x.v === t) ? t as Tab : 'stock'
}

export default function InventoryClient({ canWrite }: { canWrite: boolean }) {
  const [items, setItems]         = useState<InventoryItem[]>([])
  const [sum, setSum]             = useState<Summary | null>(null)
  const [canSeeCost, setCanSeeCost] = useState(false)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  const [tab, setTab]         = useState<Tab>(initialTab())
  const [contour, setContour] = useState<Contour | 'all'>('all')
  const [kind, setKind]       = useState<Kind | 'all'>('all')
  const [search, setSearch]   = useState('')
  const [deficit, setDeficit] = useState(false)

  const [newItem, setNewItem] = useState(false)
  const [catalog, setCatalog] = useState(false)

  useEffect(() => { reload().catch(() => setLoading(false)) }, [])

  async function reload() {
    try {
      const [i, s] = await Promise.all([
        api<ItemsResponse>('/api/inventory/items?inactive=0'),
        api<Summary>('/api/inventory/summary'),
      ])
      setError(null)
      setItems(i.items)
      setCanSeeCost(i.canSeeCost)
      setSum(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => items.filter(i => {
    if (contour !== 'all' && i.contour !== contour && i.contour !== 'both') return false
    if (kind    !== 'all' && i.kind    !== kind)   return false
    if (deficit && stockStatus(i) === 'ok')        return false
    if (search) {
      const q = search.toLowerCase()
      if (!i.name.toLowerCase().includes(q) && !i.article.toLowerCase().includes(q)) return false
    }
    return true
  }), [items, contour, kind, deficit, search])

  const kindsPresent = useMemo(
    () => KIND_ORDER.filter(k => items.some(i => i.kind === k)),
    [items],
  )

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка…</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-[1600px] mx-auto">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-[20px] font-medium text-[#111110]">Склад</h1>
            <p className="text-[13px] text-[#9a9a95] mt-1">
              Остаток считается по движениям: приход, расход, инвентаризация. Руками цифру не переписывают.
            </p>
          </div>
          {canWrite && (
            <div className="flex gap-2">
              <button className={BTN} onClick={() => setCatalog(true)}>Из справочников</button>
              <button className={BTN_P} onClick={() => setNewItem(true)}>Новая позиция</button>
            </div>
          )}
        </div>

        {error && <div className="text-[13px] text-red-600 mb-3">{error}</div>}

        {sum && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
            <Stat label="Позиций на складе" value={String(sum.items)} />
            {canSeeCost
              ? <Stat label="Стоимость запаса" value={money(sum.totalValue)} />
              : <Stat label="С остатком" value={String(items.filter(i => i.qty > 0).length)} />}
            <Stat label="B2B — стекло, зеркало" value={canSeeCost ? money(sum.b2b.value) : `${sum.b2b.items} поз.`} hint={`${sum.b2b.items} позиций`} />
            <Stat label="B2C — фурнитура" value={canSeeCost ? money(sum.b2c.value) : `${sum.b2c.items} поз.`} hint={`${sum.b2c.items} позиций`} />
            <Stat label="Дефицит" value={String(sum.deficit)} tone={sum.deficit ? 'warn' : 'ok'} />
            <Stat label="Кончилось" value={String(sum.zero)} tone={sum.zero ? 'bad' : 'ok'} />
          </div>
        )}

        <div className="flex gap-1 mb-4 border-b border-[#e4e4e0]">
          {TABS.map(t => (
            <button key={t.v} onClick={() => setTab(t.v)}
              className={`px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
                tab === t.v ? 'border-[#111110] text-[#111110]' : 'border-transparent text-[#9a9a95] hover:text-[#111110]'}`}>
              {t.l}
            </button>
          ))}
        </div>

        {(tab === 'stock' || tab === 'count') && (
          <div className="flex flex-wrap gap-2 mb-4 items-center">
            <div className="flex border border-[#e4e4e0] rounded overflow-hidden text-[13px] bg-white">
              {CONTOUR_TABS.map(c => (
                <button key={c.v} onClick={() => setContour(c.v)}
                  className={`px-3 py-1.5 ${contour === c.v ? 'bg-[#111110] text-white' : 'text-[#9a9a95] hover:text-[#111110]'}`}>
                  {c.l}
                </button>
              ))}
            </div>
            <select className={INPUT} value={kind} onChange={e => setKind(e.target.value as Kind | 'all')}>
              <option value="all">Все виды</option>
              {kindsPresent.map(k => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
            <input className={`${INPUT} flex-1 min-w-[200px] max-w-xs`} placeholder="Поиск по названию или артикулу"
              value={search} onChange={e => setSearch(e.target.value)} />
            <label className="text-[13px] text-[#9a9a95] flex items-center gap-1.5">
              <input type="checkbox" checked={deficit} onChange={e => setDeficit(e.target.checked)} />
              только дефицит
            </label>
            <span className="text-[13px] text-[#9a9a95] ml-auto">{filtered.length} из {items.length}</span>
          </div>
        )}

        {tab === 'stock'   && <StockTab items={filtered} canWrite={canWrite} canSeeCost={canSeeCost} reload={reload} />}
        {tab === 'receive' && <ReceiveTab items={items} canWrite={canWrite} canSeeCost={canSeeCost} reload={reload} />}
        {tab === 'count'   && <CountTab items={filtered} canWrite={canWrite} reload={reload} />}
        {tab === 'consume' && <ConsumeTab items={items} canWrite={canWrite} reload={reload} />}
        {tab === 'moves'   && <MovesTab canSeeCost={canSeeCost} />}

        {newItem && <ItemDialog item={null} onClose={() => setNewItem(false)} onDone={() => { setNewItem(false); reload() }} />}
        {catalog && <CatalogDialog onClose={() => setCatalog(false)} onDone={() => { setCatalog(false); reload() }} />}
      </div>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-[#111110]'
  return (
    <div className={`${CARD} px-3 py-2.5`}>
      <div className="text-[11px] uppercase tracking-wide text-[#9a9a95]">{label}</div>
      <div className={`text-[18px] mt-0.5 ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-[#9a9a95]">{hint}</div>}
    </div>
  )
}
