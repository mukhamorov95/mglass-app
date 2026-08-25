'use client'

import { useMemo, useState } from 'react'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import { FINISHES } from '@/lib/configurator/catalog'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type GlassTint } from '@/components/configurator/scene/assembly'
import { GLASS_TYPE_IDS, supplierColorToFinish, type Tier } from '@/lib/configurator/pricing'
import {
  computeKitQuantities, computeKitPrice, kitChoices, requiredRoles, defaultKitFor,
  ROLES, ROLE_META, CAP_MARGIN_MM, parseLengthMm, ROLE_GROUPS, autoShapeForRole, piecesForRole,
  PROFILE_SIDES as PROFILE_SIDES_UI,
  type RoleId, type Library, type LibraryItem, type ModelKit, type KitRates, type QtyRule,
} from '@/lib/configurator/kit'
import { auditKits } from '@/lib/configurator/audit'
import { CatalogPicker } from './CatalogPicker'

// Форма для 3D: чем позиция выглядит у клиента. По умолчанию выводится из названия,
// но название поставщика бывает неочевидным — тогда владелец задаёт форму руками.
const SHAPES: { id: string; label: string }[] = [
  { id: 'hinge-glass', label: 'Петля стекло-стекло' },
  { id: 'hinge-wall', label: 'Петля стекло-стена' },
  { id: 'handle-bar', label: 'Ручка-скоба' },
  { id: 'handle-knob', label: 'Ручка-кноб' },
  { id: 'handle-inset', label: 'Ручка-купе врезная' },
  { id: 'roller', label: 'Ролик' },
  { id: 'mount-glass', label: 'Крепление к стеклу' },
  { id: 'mount-wall', label: 'Крепление к стене' },
  { id: 'mount-corner', label: 'Крепление угловое' },
  { id: 'connector', label: 'Соединитель' },
  { id: 'cap', label: 'Заглушка' },
]

// Прайс душевых: слева модель → справа ЕЁ комплект. Цена позиции живёт в библиотеке
// тарифа (правится один раз), комплект модели держит порядок вариантов, ★ по умолчанию
// и правило количества. Количество ролей приходит из геометрии — руками не вводится.

export type TierStore = { library: Library; rates: KitRates; kits: Record<string, ModelKit> }

const GLASS_LABEL: Record<string, string> = {
  clear: 'Прозрачное М1', crystal: 'Осветлённое Crystal Vision', bronze: 'Тонированная бронза', graphite: 'Тонированная графит',
}
const TINT: Record<string, GlassTint> = {
  clear: { color: '#dcebe0', attenuation: '#a3c6ab', distance: 1.35 },
  crystal: { color: '#e9f2fb', attenuation: '#c4daef', distance: 3.2 },
  bronze: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 },
  graphite: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 },
}
const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const uid = (p: string) => `${p}-${Math.round(Math.random() * 1e9).toString(36)}`

// Числовое поле с черновиком: пока владелец печатает, значение НЕ трогаем и НЕ зажимаем
// в диапазон. Иначе на «600» после первой цифры прилетает clamp(6)→500, курсор скачет,
// и в поле оказывается что угодно, кроме введённого. Границы применяем на blur/Enter.
function NumInput({ value, onChange, w = 88, suffix = '₽', range }: {
  value: number; onChange: (v: number) => void; w?: number; suffix?: string; range?: [number, number]
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const raw = Number(draft.replace(',', '.'))
    const n = Number.isFinite(raw) ? raw : value
    const fixed = range ? Math.min(range[1], Math.max(range[0], n)) : Math.max(0, n)
    setDraft(null)
    if (fixed !== value) onChange(fixed)
  }
  return (
    <span className="flex items-center gap-1">
      <input type="text" inputMode="decimal" value={draft ?? String(value)} style={{ width: w }}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { commit(); e.currentTarget.blur() } if (e.key === 'Escape') setDraft(null) }}
        title={range ? `от ${range[0]} до ${range[1]}` : undefined}
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

export type FinanceIn = { marginPct: number; taxPct: number; minMarginPct: number; source: string }

export function KitPricingClient({ initial, finance }: { initial: Record<Tier, TierStore>; finance: Record<Tier, FinanceIn> }) {
  const [tier, setTier] = useState<Tier>('budget')
  const [store, setStore] = useState<Record<Tier, TierStore>>(initial)
  const [code, setCode] = useState('М7')
  const [glassType, setGlassType] = useState('clear')
  const [finishId, setFinishId] = useState('chrome')
  const [choice, setChoice] = useState<Partial<Record<RoleId, string>>>({})
  const [qtyChoice, setQtyChoice] = useState<Partial<Record<RoleId, number>>>({})
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [addRole, setAddRole] = useState<RoleId | ''>('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [zoneId, setZoneId] = useState('')
  const [km, setKm] = useState(0)
  const [floors, setFloors] = useState(0)
  const [installFactors, setInstallFactors] = useState<string[]>([])
  const [view, setView] = useState<'kit' | 'audit' | 'versions'>('kit')
  type Diff = { itemId: string; name: string; supplier: string; maxDeltaPct: number; note?: string
    changes: { finish: string; was: number; now: number; deltaPct: number; stockLen?: number }[] }
  const [diffs, setDiffs] = useState<Diff[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  type Saving = { itemId: string; name: string; roleLabel: string; supplier: string; cost: number
    savePerUnit: number; usedInModels: string[]
    best: { supplier: string; name: string; cost: number; url: string; imageUrl: string; match: number } }
  const [savings, setSavings] = useState<{ rows: Saving[]; totalPerItem: number; checked: number } | null>(null)
  const [seeking, setSeeking] = useState(false)
  type VersionMeta = { id: number; label: string; validDays: number; publishedBy: string; publishedAt: string }
  const [versions, setVersions] = useState<VersionMeta[] | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [vLabel, setVLabel] = useState('')
  const [vDays, setVDays] = useState(30)

  const cur = store[tier]
  const model = getModel(code)
  const kit = useMemo(() => cur.kits[code] ?? { slots: [] }, [cur.kits, code])

  const [dims, setDims] = useState(() => defaultDims(code))
  const setModelCode = (c: string) => { setCode(c); setDims(defaultDims(c)); setChoice({}); setQtyChoice({}) }

  const assembly = useMemo(() => buildFromModel(model, dims, 8), [model, dims])
  const q = useMemo(() => computeKitQuantities(assembly, 8, model, cur.rates.capMargin), [assembly, model, cur.rates.capMargin])
  const fin = finance[tier]
  const price = useMemo(
    () => computeKitPrice(q, cur.library, kit, cur.rates, fin, { glassType, finishId, choice, qtyChoice, zoneId, km, floors, installFactors }),
    [q, cur.library, kit, cur.rates, fin, glassType, finishId, choice, qtyChoice, zoneId, km, floors, installFactors],
  )
  const clientView = useMemo(() => kitChoices(cur.library, kit, q), [cur.library, kit, q])
  const byId = useMemo(() => new Map(cur.library.items.map(i => [i.id, i])), [cur.library])

  const audit = useMemo(
    () => (view === 'audit' ? auditKits(cur.library, cur.kits, cur.rates, finance[tier]) : null),
    [view, cur.library, cur.kits, cur.rates, finance, tier],
  )

  // В скольких моделях используется позиция — предупреждение, что правка цены общая.
  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const k of Object.values(cur.kits)) for (const s of k.slots) for (const e of s.entries) m.set(e.itemId, (m.get(e.itemId) ?? 0) + 1)
    return m
  }, [cur.kits])

  // Сверка с прайсом поставщика: показываем разницу, применяем только отмеченное.
  async function checkPrices() {
    setChecking(true)
    try {
      const r = await fetch(`/api/admin/configurator-kits/reprice?tier=${tier}`)
      const d = r.ok ? (await r.json()).diffs as Diff[] : []
      setDiffs(d)
      setPicked(new Set(d.filter(x => x.changes.length > 0).map(x => x.itemId)))
    } finally { setChecking(false) }
  }
  async function applyPrices() {
    setChecking(true)
    try {
      const r = await fetch('/api/admin/configurator-kits/reprice', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, itemIds: [...picked] }),
      })
      if (r.ok) { setMsg(`Цены обновлены: ${(await r.json()).applied}`); setDiffs(null); location.reload() }
    } finally { setChecking(false) }
  }

  async function loadVersions() {
    const r = await fetch('/api/admin/configurator-kits/versions')
    if (r.ok) setVersions((await r.json()).versions)
  }
  async function publishVersion() {
    if (dirty) { setMsg('Сначала сохрани изменения — версия замораживает то, что в базе'); return }
    setPublishing(true)
    try {
      const r = await fetch('/api/admin/configurator-kits/versions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: vLabel, validDays: vDays }),
      })
      if (r.ok) { setVLabel(''); setMsg('Версия прайса опубликована'); loadVersions() }
    } finally { setPublishing(false) }
  }

  async function findSavings() {
    setSeeking(true)
    try {
      const r = await fetch(`/api/admin/supplier-catalog/savings?tier=${tier}`)
      if (r.ok) setSavings(await r.json())
    } finally { setSeeking(false) }
  }

  function edit(mutate: (s: TierStore) => void) {
    setStore(prev => { const next = structuredClone(prev); mutate(next[tier]); return next })
    setDirty(true); setMsg(null)
  }
  const editKit = (mutate: (k: ModelKit) => void) => edit(s => { const k = s.kits[code] ?? { slots: [] }; mutate(k); s.kits[code] = k })
  const editItem = (id: string, mutate: (i: LibraryItem) => void) => edit(s => { const it = s.library.items.find(x => x.id === id); if (it) mutate(it) })

  // ── операции над комплектом ──
  const addSlot = (role: RoleId) => editKit(k => {
    if (k.slots.some(s => s.role === role)) return
    k.slots.push({ role, select: 'one', entries: [] })
  })
  const removeSlot = (si: number) => editKit(k => { k.slots.splice(si, 1) })
  const setSelect = (si: number, v: 'one' | 'all') => editKit(k => { k.slots[si].select = v })
  const moveEntry = (si: number, ei: number, dir: -1 | 1) => editKit(k => {
    const e = k.slots[si].entries; const j = ei + dir
    if (j < 0 || j >= e.length) return
    ;[e[ei], e[j]] = [e[j], e[ei]]
  })
  const setPrimary = (si: number, ei: number) => editKit(k => {
    k.slots[si].entries.forEach((e, i) => { e.primary = i === ei })
  })
  const removeEntry = (si: number, ei: number) => editKit(k => { k.slots[si].entries.splice(ei, 1) })
  const setQtyRule = (si: number, ei: number, qty: QtyRule) => editKit(k => { k.slots[si].entries[ei].qty = qty })
  const resetKit = () => edit(s => { s.kits[code] = defaultKitFor(model, s.library) })
  const excludeRole = (role: RoleId) => editKit(k => {
    k.slots = k.slots.filter(sl => sl.role !== role)
    k.excluded = [...new Set([...(k.excluded ?? []), role])]
  })
  const unexcludeRole = (role: RoleId) => editKit(k => { k.excluded = (k.excluded ?? []).filter(r => r !== role) })
  const setShape = (id: string, shape: string) => editItem(id, i => { if (shape) i.shape = shape; else delete i.shape })

  // Позиция нужна не одной модели: добавляем её в комплект всех моделей, где эта роль есть.
  function applyToAllModels(itemId: string, role: RoleId) {
    edit(s => {
      for (const m of M_MODELS) {
        const k = s.kits[m.code] ?? defaultKitFor(getModel(m.code), s.library)
        const slot = k.slots.find(sl => sl.role === role)
        if (!slot || slot.entries.some(e => e.itemId === itemId)) continue
        slot.entries.push({ itemId, qty: { mode: 'role' }, ...(slot.entries.length === 0 ? { primary: true } : {}) })
        s.kits[m.code] = k
      }
    })
  }

  // Второй тариф начинают не с нуля: переносим библиотеку и комплекты, дальше правятся цены.
  function copyFromOtherTier() {
    const other: Tier = tier === 'budget' ? 'premium' : 'budget'
    setStore(prev => {
      const next = structuredClone(prev)
      next[tier] = { ...next[tier], library: structuredClone(prev[other].library), kits: structuredClone(prev[other].kits) }
      return next
    })
    setDirty(true); setMsg(null)
  }

  // ── пикер справочника: позиция уезжает в библиотеку с ролью слота ──
  const [picker, setPicker] = useState<{ si: number; itemId?: string } | null>(null)
  // Длину хлыста берём из полного названия поставщика («…длина 2,2 м»): гадать нельзя —
  // ошибка в длине тихо ломает раскрой. Не распозналось — 0, владелец увидит пустое поле.
  async function applyPick(rowId: number) {
    const target = picker
    setPicker(null)
    if (!target) return
    // Сначала подтягиваем карточку с сайта поставщика (ссылка, фото, характеристики),
    // потом читаем варианты — так позиция сразу приезжает с фото.
    await fetch('/api/admin/supplier-catalog/enrich', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [rowId] }),
    }).catch(() => {})
    const res = await fetch(`/api/admin/supplier-catalog/variants?id=${rowId}`)
    if (!res.ok) return
    const { variants, name, supplier, base, imageUrl, specs } = await res.json() as {
      variants: { color: string; cost_price: number }[]; name: string; supplier: string; base: string
      imageUrl?: string; specs?: Record<string, string>
    }
    const byFinish: Record<string, number> = {}
    for (const v of variants) {
      const f = supplierColorToFinish(v.color)
      if (f && !(f in byFinish)) byFinish[f] = Math.round(v.cost_price)
    }
    if (Object.keys(byFinish).length === 0 && variants.length) byFinish[finishId] = Math.round(variants[0].cost_price)
    const label = name.length > 60 ? name.slice(0, 60) + '…' : name
    const shortName = name.split('.')[0].slice(0, 48)

    edit(s => {
      const slot = (s.kits[code] ?? { slots: [] }).slots[target.si]
      if (!slot) return
      const isBar = ROLE_META[slot.role].kind === 'bar'
      if (target.itemId) {          // обновляем цены существующей позиции
        const it = s.library.items.find(x => x.id === target.itemId)
        if (!it) return
        if (isBar) it.stocks = [{ len: parseLengthMm(name), prices: byFinish }, ...(it.stocks ?? [])]
        else it.prices = { ...it.prices, ...byFinish }
        it.ref = { supplier, base, label }
        if (imageUrl) it.image = imageUrl
        if (specs && Object.keys(specs).length) it.specs = specs
        return
      }
      const id = uid('it')
      s.library.items.push({
        id, name: shortName, role: slot.role, ref: { supplier, base, label },
        ...(imageUrl ? { image: imageUrl } : {}),
        ...(specs && Object.keys(specs).length ? { specs } : {}),
        ...(isBar ? { stocks: [{ len: parseLengthMm(name), prices: byFinish }] } : { prices: byFinish }),
      })
      const k = s.kits[code]!
      const sl = k.slots[target.si]
      sl.entries.push({ itemId: id, qty: { mode: 'role' }, ...(sl.entries.length === 0 ? { primary: true } : {}) })
    })
  }
  const addManual = (si: number) => edit(s => {
    const slot = (s.kits[code] ?? { slots: [] }).slots[si]
    if (!slot) return
    const isBar = ROLE_META[slot.role].kind === 'bar'
    const id = uid('it')
    s.library.items.push({ id, name: 'Новая позиция', role: slot.role, ...(isBar ? { stocks: [{ len: 2200, prices: {} }] } : { prices: {} }) })
    slot.entries.push({ itemId: id, qty: { mode: 'role' }, ...(slot.entries.length === 0 ? { primary: true } : {}) })
  })

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/configurator-kits', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, library: cur.library, rates: cur.rates, code, kit }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка сохранения')
      setDirty(false); setMsg('Сохранено')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
    finally { setSaving(false) }
  }

  const colorLabel = FINISHES.find(f => f.id === finishId)?.label ?? finishId
  const needed = requiredRoles(model)
  const freeRoles = ROLES.filter(r => !kit.slots.some(s => s.role === r))
  const c = model.constraints

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Прайс душевых · комплект модели</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Слева модель — справа из чего она состоит. Количество берётся из геометрии, цена — из справочника.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-[13px] ${msg === 'Сохранено' ? 'text-[#256029]' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={save} disabled={!dirty || saving}
            className={`text-[13px] font-medium px-4 py-2 rounded-lg ${dirty && !saving ? 'bg-[#111110] text-white hover:bg-[#2a2a28]' : 'bg-[#eee] text-[#9a9a95]'}`}>
            {saving ? 'Сохраняю…' : `Сохранить ${code} · ${tier === 'budget' ? 'Бюджет' : 'Премиум'}`}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="inline-flex rounded-lg border border-[#e4e4e0] overflow-hidden text-[13px] font-medium">
          <button onClick={() => setTier('budget')} className={`px-5 py-2 ${tier === 'budget' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Бюджет</button>
          <button onClick={() => setTier('premium')} className={`px-5 py-2 ${tier === 'premium' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Премиум</button>
        </div>
        <div className="inline-flex rounded-lg border border-[#e4e4e0] overflow-hidden text-[13px] font-medium">
          <button onClick={() => setView('kit')} className={`px-4 py-2 ${view === 'kit' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Комплекты</button>
          <button onClick={() => setView('audit')} className={`px-4 py-2 ${view === 'audit' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Аудит</button>
          <button onClick={() => { setView('versions'); if (!versions) loadVersions() }} className={`px-4 py-2 ${view === 'versions' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Версии прайса</button>
        </div>
        <button onClick={copyFromOtherTier} className="text-[12px] text-[#4b6ea9] hover:underline">
          ↳ Заполнить из «{tier === 'budget' ? 'Премиум' : 'Бюджет'}» (позиции и комплекты)
        </button>
      </div>

      {view === 'versions' && (
        <div className="space-y-4 max-w-[820px]">
          <Card title="Опубликовать версию прайса">
            <p className="text-[13px] text-[#6b6b66] mb-3">
              Версия замораживает весь прайс (позиции, комплекты, ставки, маржу) на сегодня. КП, выданное по
              версии, всегда пересчитывается по её ценам — клиент не увидит другую сумму после подорожания,
              и мы не продадим по устаревшей себестоимости.
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <label className="text-[13px] text-[#4b4b47]">Метка
                <input value={vLabel} onChange={e => setVLabel(e.target.value)} placeholder="напр. «сентябрь, Ветро +8%»"
                  className="block mt-0.5 w-[300px] text-[13px] border border-[#e4e4e0] rounded-md px-2 py-1.5 outline-none focus:border-[#111110]" /></label>
              <label className="text-[13px] text-[#4b4b47]">Срок КП
                <span className="block mt-0.5"><NumInput value={vDays} onChange={setVDays} suffix="дн" w={64} /></span></label>
              <button onClick={publishVersion} disabled={publishing}
                className="text-[13px] font-medium px-4 py-2 rounded-lg bg-[#111110] text-white disabled:bg-[#eee] disabled:text-[#9a9a95]">
                {publishing ? 'Публикую…' : 'Опубликовать'}
              </button>
            </div>
            {dirty && <p className="text-[12px] text-[#b04a3f] mt-2">Есть несохранённые правки — сначала «Сохранить».</p>}
          </Card>

          <Card title="Опубликованные версии">
            {!versions && <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>}
            {versions?.length === 0 && <p className="text-[13px] text-[#9a9a95]">Пока ни одной версии. Прайс работает вживую.</p>}
            {versions?.map(v => {
              const until = new Date(new Date(v.publishedAt).getTime() + v.validDays * 86400000)
              return (
                <div key={v.id} className="flex items-center gap-2 py-2 border-t border-[#f4f4f0] first:border-0 text-[13px]">
                  <span className="font-mono text-[#9a9a95] w-8">#{v.id}</span>
                  <span className="text-[#111110] flex-1 truncate">{v.label || '— без метки —'}</span>
                  <span className="text-[#6b6b66]">{new Date(v.publishedAt).toLocaleDateString('ru-RU')}</span>
                  <span className="text-[#9a9a95]">КП до {until.toLocaleDateString('ru-RU')}</span>
                  <span className="text-[#9a9a95] truncate max-w-[160px]">{v.publishedBy}</span>
                </div>
              )
            })}
          </Card>
        </div>
      )}

      {view === 'audit' && audit && (
        <div className="space-y-4 max-w-[980px]">
          <Card>
            <div className="flex items-baseline gap-3">
              <p className="text-[28px] font-semibold text-[#111110] leading-none">{audit.ready}<span className="text-[#9a9a95] text-[18px]"> из {audit.total}</span></p>
              <p className="text-[13px] text-[#6b6b66]">моделей можно показывать клиенту с ценой в тарифе «{tier === 'budget' ? 'Бюджет' : 'Премиум'}»</p>
            </div>
            <p className="text-[12px] text-[#9a9a95] mt-1.5">
              Каждая модель прогнана на трёх размерах (минимум, середина, максимум) во всех {FINISHES.length} цветах.
              Блокер — клиент увидит «по запросу» вместо цены.
            </p>
          </Card>

          <Card title="Цены поставщика">
            <div className="flex items-center gap-3">
              <button onClick={checkPrices} disabled={checking}
                className="text-[13px] font-medium px-3 py-1.5 rounded-lg bg-[#111110] text-white disabled:bg-[#eee] disabled:text-[#9a9a95]">
                {checking ? 'Сверяю…' : 'Сверить со справочником'}
              </button>
              {diffs && <span className="text-[13px] text-[#6b6b66]">
                {diffs.length === 0 ? 'Все цены совпадают с прайсом' : `Расхождений: ${diffs.length}`}
              </span>}
              {diffs && picked.size > 0 && (
                <button onClick={applyPrices} disabled={checking}
                  className="ml-auto text-[13px] font-medium px-3 py-1.5 rounded-lg border border-[#111110] text-[#111110]">
                  Применить отмеченные ({picked.size})
                </button>
              )}
            </div>
            {diffs?.map(d => (
              <div key={d.itemId} className="flex items-start gap-2 py-1.5 mt-1 border-t border-[#f4f4f0] text-[13px]">
                <input type="checkbox" checked={picked.has(d.itemId)} disabled={d.changes.length === 0}
                  onChange={e => setPicked(p => { const n = new Set(p); if (e.target.checked) n.add(d.itemId); else n.delete(d.itemId); return n })}
                  className="mt-1" />
                <span className="w-[240px] shrink-0 truncate text-[#111110]">{d.name}</span>
                {d.note
                  ? <span className="text-[#b09a6a]">{d.note}</span>
                  : <span className="text-[#6b6b66]">
                      {d.changes.slice(0, 4).map(c => `${c.finish}${c.stockLen ? ` ${c.stockLen}мм` : ''}: ${c.was} → ${c.now} (${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%)`).join(' · ')}
                      {d.changes.length > 4 && ` …и ещё ${d.changes.length - 4}`}
                    </span>}
              </div>
            ))}
            <p className="text-[11px] text-[#9a9a95] mt-2">
              Автоматически ничего не переписывается: цена изделия не должна меняться без твоего ведома.
              История цен пишется при каждом импорте прайса.
            </p>
          </Card>

          <Card title="Где мы переплачиваем">
            <div className="flex items-center gap-3">
              <button onClick={findSavings} disabled={seeking}
                className="text-[13px] font-medium px-3 py-1.5 rounded-lg bg-[#111110] text-white disabled:bg-[#eee] disabled:text-[#9a9a95]">
                {seeking ? 'Ищу…' : 'Найти дешевле у поставщиков'}
              </button>
              {savings && (
                <span className="text-[13px] text-[#6b6b66]">
                  {savings.rows.length === 0
                    ? `Проверено позиций: ${savings.checked}. Дешевле не нашлось — берём по лучшей цене`
                    : `Нашлось ${savings.rows.length} из ${savings.checked}: до ${rub(savings.totalPerItem)} на изделии`}
                </span>
              )}
            </div>
            {savings?.rows.map(r => (
              <div key={r.itemId} className="py-2 mt-1 border-t border-[#f4f4f0]">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-[10px] uppercase text-[#a0a09a] w-[120px] shrink-0">{r.roleLabel}</span>
                  <span className="text-[#111110] truncate flex-1">{r.name}</span>
                  <span className="font-mono text-[#6b6b66] shrink-0">{rub(r.cost)}</span>
                  <span className="text-[#256029] font-semibold shrink-0">−{rub(r.savePerUnit)}</span>
                </div>
                <div className="flex items-center gap-2 pl-[128px] text-[12px] text-[#6b6b66]">
                  {r.best.imageUrl && <img src={r.best.imageUrl} alt="" className="w-6 h-6 rounded object-cover border border-[#eeece5]" />}
                  <span className="truncate flex-1">
                    {r.best.supplier}: {r.best.name} — {rub(r.best.cost)}
                    {r.best.url && <a href={r.best.url} target="_blank" rel="noreferrer" className="ml-1 text-[#4b6ea9] hover:underline">карточка</a>}
                  </span>
                  <span className="text-[#9a9a95] shrink-0">стоит в {r.usedInModels.length} моделях</span>
                </div>
              </div>
            ))}
            <p className="text-[11px] text-[#9a9a95] mt-2">
              Сравниваются только позиции из комплектов и только в базовом цвете, чтобы не сравнить хром с золотом.
              Брак и «эконом» исключены. Замена — решение закупщика: у дешёвой позиции может быть другое качество.
            </p>
          </Card>

          {audit.libraryIssues.length > 0 && (
            <Card title="Библиотека позиций">
              {audit.libraryIssues.map((i, n) => (
                <div key={n} className="flex items-start gap-2 py-1 text-[13px] border-b border-[#f4f4f0] last:border-0">
                  <span className={i.severity === 'blocker' ? 'text-[#b04a3f]' : 'text-[#b09a6a]'}>{i.severity === 'blocker' ? '●' : '○'}</span>
                  <span className="text-[#111110] w-[220px] shrink-0 truncate">{i.label}</span>
                  <span className="text-[#6b6b66]">{i.detail}</span>
                </div>
              ))}
            </Card>
          )}

          <Card title="Модели">
            {audit.models.map(m => (
              <div key={m.code} className="py-2 border-b border-[#f4f4f0] last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] ${m.sellable ? 'text-[#256029]' : 'text-[#b04a3f]'}`}>{m.sellable ? '✅' : '⛔'}</span>
                  <button onClick={() => { setModelCode(m.code); setView('kit') }} className="text-[13px] text-[#111110] hover:underline">
                    <span className="font-mono">{m.code}</span> · {m.name}
                  </button>
                  <span className="ml-auto font-mono text-[12px] text-[#6b6b66]">
                    {m.sizes.length > 0 && `${rub(m.sizes[0].total)} … ${rub(m.sizes[m.sizes.length - 1].total)}`}
                  </span>
                </div>
                {m.issues.length > 0 && (
                  <div className="pl-6 pt-0.5">
                    {m.issues.slice(0, 6).map((i, n) => (
                      <p key={n} className={`text-[12px] ${i.severity === 'blocker' ? 'text-[#9a5a2a]' : 'text-[#9a9a95]'}`}>
                        {i.label} — {i.code}
                      </p>
                    ))}
                    {m.issues.length > 6 && <p className="text-[12px] text-[#9a9a95]">…и ещё {m.issues.length - 6}</p>}
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}

      <div className={`${view !== 'kit' ? 'hidden ' : ''}grid grid-cols-1 lg:grid-cols-[200px_1fr_440px] gap-5 items-start`}>
        {/* Модельный ряд */}
        <div className="grid gap-1.5 lg:sticky lg:top-4">
          {M_MODELS.map(m => {
            const k = cur.kits[m.code]
            const filled = k ? k.slots.filter(s => s.entries.length > 0).length : 0
            const total = k ? k.slots.length : 0
            return (
              <button key={m.code} onClick={() => setModelCode(m.code)}
                className={`text-left px-3 py-2 rounded-lg text-[13px] border ${code === m.code ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                <span className="font-mono">{m.code}</span> · {m.name}
                <span className={`block text-[10px] mt-0.5 ${code === m.code ? 'text-white/60' : filled === total && total > 0 ? 'text-[#5a8a5a]' : 'text-[#b09a6a]'}`}>
                  {total === 0 ? 'комплект пуст' : `${filled} из ${total} ролей`}
                </span>
              </button>
            )
          })}
        </div>

        {/* 3D + размеры + спецификация */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-3">
            <Partition3DView model={model} dims={dims} thickness={8}
              finishHex={FINISHES.find(f => f.id === finishId)?.hex ?? '#c9ccd0'} finishId={finishId} glassTint={TINT[glassType]}
              choice={{ hinge: byId.get(choice.hinge ?? '')?.shape, handle: byId.get(choice.handle ?? '')?.shape }} />
          </div>

          <Card title="Размеры для проверки">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[13px] text-[#4b4b47]">Ширина
                <NumInput value={dims.width} range={c.width} onChange={v => setDims(d => ({ ...d, width: v }))} w={70} suffix="мм" /></label>
              {c.needsWidth2 && c.width2 && (
                <label className="flex items-center gap-1.5 text-[13px] text-[#4b4b47]">Вторая
                  <NumInput value={dims.width2 ?? 0} range={c.width2!} onChange={v => setDims(d => ({ ...d, width2: v }))} w={70} suffix="мм" /></label>
              )}
              <label className="flex items-center gap-1.5 text-[13px] text-[#4b4b47]">Высота
                <NumInput value={dims.height} range={c.height} onChange={v => setDims(d => ({ ...d, height: v }))} w={70} suffix="мм" /></label>
              {c.doorWidth && (
                <label className="flex items-center gap-1.5 text-[13px] text-[#4b4b47]">Дверь
                  <NumInput value={dims.doorWidth ?? 0} range={c.doorWidth!} onChange={v => setDims(d => ({ ...d, doorWidth: v }))} w={70} suffix="мм" /></label>
              )}
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-2">
              Геометрия даёт: секций {q.sections} · стекла {q.glassM2} м² · петель {q.roleQty.hinge} · куски профиля {q.profilePieces.join(' / ') || '—'} мм
            </p>
          </Card>

          <Card title={`Спецификация ${model.code} · ${colorLabel}`}>
            {price.missing.length > 0 ? (
              <div className="mb-2 rounded-lg bg-[#fdf3ec] border border-[#f0d9c4] px-3 py-2 text-[12px] text-[#9a5a2a]">
                ⚠️ Не хватает: <b>{price.missing.map(m => `${m.label} (${m.reason})`).join(', ')}</b>
              </div>
            ) : (
              <div className="mb-2 rounded-lg bg-[#f0f7f0] border border-[#cfe6cf] px-3 py-2 text-[12px] text-[#256029]">✅ Комплект полный · {colorLabel}</div>
            )}
            <div className="flex justify-between text-[13px] py-0.5">
              <span className="text-[#4b4b47]">Стекло {GLASS_LABEL[glassType]}</span>
              <span className="font-mono">{q.glassM2} м² · {rub(price.glassCost)}</span>
            </div>
            {price.lines.map(l => (
              <div key={`${l.role}-${l.itemId}`} className="flex justify-between text-[13px] py-0.5">
                <span className="text-[#4b4b47] truncate pr-2">
                  <span className="text-[#a0a09a] text-[11px] uppercase mr-1">{ROLE_META[l.role].label}</span>{l.label}
                </span>
                <span className="font-mono shrink-0">
                  {l.unit === 'хлыст'
                    ? `${l.plan?.map(b => `${b.len}`).join('+')} = ${rub(l.total)}`
                    : `${l.qty}×${rub(l.unitPrice)} = ${rub(l.total)}`}
                </span>
              </div>
            ))}
            <div className="flex justify-between text-[13px] pt-2 mt-1 border-t border-[#f0f0ec]"><span className="text-[#6b6b66]">Себестоимость</span><span className="font-mono">{rub(price.materialsCost)}</span></div>
            <div className="flex justify-between text-[13px] py-0.5">
              <span className="text-[#4b4b47]">
                Цена изделия (маржа {price.marginPct}% {price.marginSource === 'модель' ? '— своя у модели' : '— тариф'}, налог {price.taxPct}%)
              </span>
              <span className="font-mono">{rub(price.itemPrice)}</span>
            </div>
            {price.belowMin && (
              <p className="text-[11px] text-[#b04a3f] py-0.5">⚠️ Маржа ниже минимальной {fin.minMarginPct}% — так продавать нельзя</p>
            )}
            <div className="flex justify-between text-[13px]"><span className="text-[#4b4b47]">Монтаж {q.sections}×{rub(cur.rates.installPerSection)}{price.installExtra > 0 ? ` + надбавки ${rub(price.installExtra)}` : ''}</span><span className="font-mono">{rub(price.installCost)}</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#4b4b47]">Доставка · {price.deliveryZone}</span><span className="font-mono">{rub(price.deliveryCost)}</span></div>
            {price.liftCost > 0 && <div className="flex justify-between text-[13px]"><span className="text-[#4b4b47]">Подъём {floors} эт.</span><span className="font-mono">{rub(price.liftCost)}</span></div>}
            <div className="flex justify-between text-[14px] font-semibold pt-1"><span>Сумма изделия</span><span className="font-mono">{rub(price.total)}</span></div>
            {((cur.rates.deliveryZones ?? []).length > 0 || (cur.rates.installSurcharges ?? []).length > 0) && (
              <div className="mt-2 pt-2 border-t border-[#f0f0ec] space-y-1.5">
                {(cur.rates.deliveryZones ?? []).length > 0 && (
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="text-[#9a9a95] w-14">Зона</span>
                    <select value={zoneId} onChange={e => setZoneId(e.target.value)} className="text-[12px] border border-[#e4e4e0] rounded-md px-1 py-0.5 outline-none focus:border-[#111110]">
                      <option value="">Москва</option>
                      {(cur.rates.deliveryZones ?? []).map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
                    </select>
                    <NumInput value={km} onChange={setKm} w={54} suffix="км" />
                    <span className="text-[#9a9a95] ml-1">этаж</span><NumInput value={floors} onChange={setFloors} w={40} suffix="" />
                  </div>
                )}
                {(cur.rates.installSurcharges ?? []).map(f => (
                  <label key={f.id} className="flex items-center gap-1.5 text-[12px] text-[#4b4b47]">
                    <input type="checkbox" checked={installFactors.includes(f.id)}
                      onChange={e => setInstallFactors(v => e.target.checked ? [...v, f.id] : v.filter(x => x !== f.id))} />
                    {f.label} <span className="text-[#9a9a95]">({f.kind === 'per-section' ? 'за секцию' : 'разово'} {rub(f.amount)})</span>
                  </label>
                ))}
              </div>
            )}
          </Card>

          {(clientView.variants.length > 0 || clientView.quantities.length > 0) && (
            <Card title="Что увидит клиент">
              {clientView.variants.map(v => (
                <div key={v.role} className="flex flex-wrap items-center gap-1.5 py-1">
                  <span className="text-[12px] text-[#6b6b66] w-[150px]">{v.label}</span>
                  {v.options.map(o => (
                    <button key={o.itemId} onClick={() => setChoice(ch => ({ ...ch, [v.role]: o.itemId }))}
                      className={`text-[12px] px-2 py-1 rounded-md border ${(choice[v.role] ?? v.options[0].itemId) === o.itemId ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>
                      {o.primary && '★ '}{o.name}
                    </button>
                  ))}
                </div>
              ))}
              {clientView.quantities.map(v => (
                <div key={`q-${v.role}`} className="flex flex-wrap items-center gap-1.5 py-1">
                  <span className="text-[12px] text-[#6b6b66] w-[150px]">{v.label} — количество</span>
                  {v.options.map(n => (
                    <button key={n} onClick={() => setQtyChoice(qc => ({ ...qc, [v.role]: n }))}
                      className={`text-[12px] px-2.5 py-1 rounded-md border ${(qtyChoice[v.role] ?? v.def) === n ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* Комплект модели */}
        <div className="space-y-3">
          <Card title="Стекло · ₽/м²">
            {GLASS_TYPE_IDS.map(g => (
              <label key={g} className="flex items-center justify-between gap-2 text-[13px] py-0.5">
                <span className="text-[#4b4b47]">{GLASS_LABEL[g]}</span>
                <NumInput value={cur.rates.glassPerM2[g] ?? 0} onChange={v => edit(s => { s.rates.glassPerM2[g] = v })} suffix="₽/м²" />
              </label>
            ))}
            <p className="text-[11px] text-[#9a9a95] mt-1">Показать в 3D: {GLASS_TYPE_IDS.map(g => (
              <button key={g} onClick={() => setGlassType(g)} className={`ml-1 underline ${glassType === g ? 'text-[#111110] font-semibold' : ''}`}>{GLASS_LABEL[g].split(' ')[0]}</button>
            ))}</p>
          </Card>

          <Card title="Цвет фурнитуры">
            <div className="flex flex-wrap gap-1.5">
              {FINISHES.map(f => (
                <button key={f.id} onClick={() => setFinishId(f.id)} title={f.label}
                  className={`w-7 h-7 rounded-md border-2 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`} style={{ background: f.hex }} />
              ))}
            </div>
            <p className="text-[12px] text-[#6b6b66] mt-1.5">Цены ниже — для цвета <b className="text-[#111110]">{colorLabel}</b>.</p>
          </Card>

          <div className="flex items-center justify-between px-1">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Комплект {model.code}</p>
            <button onClick={resetKit} className="text-[11px] text-[#4b6ea9] hover:underline">собрать заново по геометрии</button>
          </div>

          {kit.slots.length === 0 && (
            <Card><p className="text-[13px] text-[#b0b0aa] italic">Комплект пуст — добавь роль ниже или собери заново по геометрии.</p></Card>
          )}

          {ROLE_GROUPS.map(grp => {
            const inGroup = kit.slots.map((slot, si) => ({ slot, si })).filter(x => grp.roles.includes(x.slot.role))
            if (inGroup.length === 0) return null
            const filled = inGroup.filter(x => x.slot.entries.length > 0).length
            const isOpen = !collapsed[grp.id]
            return (
              <div key={grp.id} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <button onClick={() => setCollapsed(c => ({ ...c, [grp.id]: !c[grp.id] }))}
                  className="w-full flex items-center gap-2 px-4 py-2.5 bg-[#faf9f6] border-b border-[#eeece5] text-left hover:bg-[#f5f4ef]">
                  <span className={`text-[10px] text-[#9a9a95] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
                  <span className="text-[13px] font-semibold text-[#111110]">{grp.title}</span>
                  <span className={`text-[11px] ${filled === inGroup.length ? 'text-[#5a8a5a]' : 'text-[#b09a6a]'}`}>
                    {filled} из {inGroup.length}
                  </span>
                  <span className="ml-auto text-[11px] text-[#9a9a95]">
                    {inGroup.map(x => ROLE_META[x.slot.role].label).join(' · ')}
                  </span>
                </button>
                {isOpen && <div className="p-2 space-y-2">
                {inGroup.map(({ slot, si }) => {
            const meta = ROLE_META[slot.role]
            const qty = meta.kind === 'bar' ? piecesForRole(q, kit, slot.role).length : (q.roleQty[slot.role] ?? 0)
            const unneeded = qty === 0
            return (
              <div key={slot.role} className="rounded-lg border border-[#eeece5] bg-white pl-3 pr-3 py-2.5 border-l-[3px] border-l-[#e0ddd2]">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[13px] font-medium text-[#111110]">{meta.label}</p>
                  {unneeded
                    ? <span className="text-[10px] text-[#b09a6a]">модели не нужна</span>
                    : <span className="text-[10px] text-[#8a9a7a]">×{qty} из геометрии</span>}
                  <span className="ml-auto inline-flex rounded-md border border-[#e4e4e0] overflow-hidden text-[10px]">
                    <button onClick={() => setSelect(si, 'one')} className={`px-2 py-0.5 ${slot.select === 'one' ? 'bg-[#111110] text-white' : 'bg-white text-[#6b6b66]'}`}>одна из списка</button>
                    <button onClick={() => setSelect(si, 'all')} className={`px-2 py-0.5 ${slot.select === 'all' ? 'bg-[#111110] text-white' : 'bg-white text-[#6b6b66]'}`}>все сразу</button>
                  </span>
                  <button onClick={() => removeSlot(si)} title="Убрать эту подгруппу из модели"
                    className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-0.5">×</button>
                </div>
                <p className="text-[11px] text-[#9a9a95] mb-2">{meta.hint}</p>

                {slot.entries.length === 0 && <p className="text-[12px] text-[#b0b0aa] italic py-1">Пусто — добавь позицию ↓</p>}

                {slot.entries.map((e, ei) => {
                  const it = byId.get(e.itemId)
                  if (!it) return null
                  const used = usage.get(it.id) ?? 0
                  return (
                    <div key={e.itemId} className="py-1 border-b border-[#f4f4f0] last:border-0">
                      <div className="flex items-center gap-1">
                        {it.image
                          ? <img src={it.image} alt="" className="w-7 h-7 rounded object-cover border border-[#eeece5] shrink-0" />
                          : <span className="w-7 h-7 rounded bg-[#f6f5f1] border border-[#eeece5] shrink-0" />}
                        {slot.select === 'one' && (
                          <button onClick={() => setPrimary(si, ei)} title={e.primary ? 'Показывается клиенту первой' : 'Сделать вариантом по умолчанию'}
                            className={`text-[14px] leading-none shrink-0 ${e.primary ? 'text-[#e0a200]' : 'text-[#d0d0cc] hover:text-[#e0a200]'}`}>{e.primary ? '★' : '☆'}</button>
                        )}
                        <input value={it.name} onChange={ev => editItem(it.id, i => { i.name = ev.target.value })}
                          className="flex-1 min-w-0 text-[13px] text-[#4b4b47] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
                        {meta.kind === 'piece' && (
                          <NumInput value={it.prices?.[finishId] ?? 0} onChange={v => editItem(it.id, i => { i.prices = { ...i.prices, [finishId]: v } })} w={76} />
                        )}
                        <button onClick={() => setPicker({ si, itemId: it.id })} title="Цена из справочника" className="text-[13px] leading-none px-0.5 hover:opacity-70">📗</button>
                        <span className="flex flex-col leading-none">
                          <button onClick={() => moveEntry(si, ei, -1)} className="text-[9px] text-[#c4c4be] hover:text-[#111110]">▲</button>
                          <button onClick={() => moveEntry(si, ei, 1)} className="text-[9px] text-[#c4c4be] hover:text-[#111110]">▼</button>
                        </span>
                        <button onClick={() => removeEntry(si, ei)} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-0.5">×</button>
                      </div>

                      {meta.kind === 'bar' && (
                        <div className="pl-2 pt-0.5">
                          {(it.stocks ?? []).map((st, sti) => (
                            <div key={sti} className="flex items-center gap-1.5 py-0.5">
                              <span className="text-[11px] text-[#9a9a95] w-10">Хлыст</span>
                              <NumInput value={st.len} onChange={v => editItem(it.id, i => { i.stocks![sti].len = v })} w={62} suffix="мм" />
                              <NumInput value={st.prices?.[finishId] ?? 0} onChange={v => editItem(it.id, i => { i.stocks![sti].prices = { ...i.stocks![sti].prices, [finishId]: v } })} w={76} />
                              <button onClick={() => editItem(it.id, i => { i.stocks!.splice(sti, 1) })} className="text-[#c4c4be] hover:text-[#b04a3f] text-[14px] leading-none px-1">×</button>
                            </div>
                          ))}
                          <button onClick={() => editItem(it.id, i => { i.stocks = [...(i.stocks ?? []), { len: 0, prices: {} }] })}
                            className="text-[12px] text-[#4b6ea9] hover:underline">+ хлыст другой длины</button>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pl-2 pt-0.5">
                        <QtyRuleEditor rule={e.qty} onChange={r => setQtyRule(si, ei, r)} />
                        {meta.kind === 'piece' && (
                          <select value={it.shape ?? ''} onChange={ev => setShape(it.id, ev.target.value)}
                            title="Как позиция выглядит в 3D у клиента"
                            className="text-[11px] border border-[#e4e4e0] rounded-md px-1 py-0.5 text-[#6b6b66] outline-none focus:border-[#111110]">
                            <option value="">вид: авто ({SHAPES.find(sh => sh.id === autoShapeForRole(it.name, it.role))?.label ?? 'по названию'})</option>
                            {SHAPES.map(sh => <option key={sh.id} value={sh.id}>вид: {sh.label}</option>)}
                          </select>
                        )}
                        <button onClick={() => applyToAllModels(it.id, slot.role)} title="Добавить эту позицию в комплекты всех моделей, где есть такая роль"
                          className="text-[11px] text-[#4b6ea9] hover:underline">во все модели</button>
                        {used > 1 && <span className="text-[10px] text-[#b09a6a]" title="Цена общая для всех моделей">в {used} моделях</span>}
                        {it.specs && Object.keys(it.specs).length > 0 && (
                          <span className="text-[10px] text-[#6b6b66]" title="Характеристики с сайта поставщика">
                            {Object.entries(it.specs).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                          </span>
                        )}
                        {it.ref && <span className="text-[10px] text-[#8a9a7a] truncate">🔗 {it.ref.label ?? it.ref.base}</span>}
                      </div>
                    </div>
                  )
                })}

                <div className="flex gap-3 mt-1.5">
                  <button onClick={() => setPicker({ si })} className="text-[12px] font-medium text-[#256029] hover:underline">📗 из справочника</button>
                  <button onClick={() => addManual(si)} className="text-[12px] text-[#9a9a95] hover:underline">+ вручную</button>
                </div>
              </div>
            )
          })}
                </div>}
              </div>
            )
          })}

          {(() => {
            const gaps = needed.filter(r => !kit.slots.some(sl => sl.role === r)
              && !(kit.excluded ?? []).includes(r)
              && !(PROFILE_SIDES_UI.includes(r) && kit.slots.some(sl => sl.role === 'profile')))
            const excluded = kit.excluded ?? []
            if (gaps.length === 0 && excluded.length === 0) return null
            return (
              <Card title="Модель требует, а в комплекте нет">
                {gaps.map(r => (
                  <div key={r} className="flex items-center gap-2 py-1 text-[13px]">
                    <span className="text-[#9a5a2a]">⚠️ {ROLE_META[r].label}</span>
                    <button onClick={() => addSlot(r)} className="ml-auto text-[12px] text-[#256029] hover:underline">добавить</button>
                    <button onClick={() => excludeRole(r)} className="text-[12px] text-[#9a9a95] hover:underline" title="В этой модели такая позиция не используется">не используется</button>
                  </div>
                ))}
                {excluded.map(r => (
                  <div key={r} className="flex items-center gap-2 py-1 text-[13px] text-[#9a9a95]">
                    <span>— {ROLE_META[r].label}: не используется</span>
                    <button onClick={() => unexcludeRole(r)} className="ml-auto text-[12px] text-[#4b6ea9] hover:underline">вернуть</button>
                  </div>
                ))}
              </Card>
            )
          })()}

          <Card title="Добавить роль">
            <div className="flex items-center gap-2">
              <select value={addRole} onChange={e => setAddRole(e.target.value as RoleId | '')}
                className="flex-1 text-[13px] border border-[#e4e4e0] rounded-lg px-2 py-1.5 outline-none focus:border-[#111110]">
                <option value="">— выбери, что ещё есть в модели —</option>
                {ROLE_GROUPS.map(g => {
                  const free = g.roles.filter(r => freeRoles.includes(r))
                  if (free.length === 0) return null
                  return (
                    <optgroup key={g.id} label={g.title}>
                      {free.map(r => <option key={r} value={r}>{ROLE_META[r].label}{needed.includes(r) ? ' — нужна модели' : ''}</option>)}
                    </optgroup>
                  )
                })}
              </select>
              <button onClick={() => { if (addRole) { addSlot(addRole); setAddRole('') } }} disabled={!addRole}
                className={`text-[13px] font-medium px-3 py-1.5 rounded-lg ${addRole ? 'bg-[#111110] text-white' : 'bg-[#eee] text-[#9a9a95]'}`}>Добавить</button>
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-1.5">
              Роли, которые модель требует, но их нет в комплекте, попадают в предупреждение спецификации.
            </p>
          </Card>

          <Card title="Финансы">
            <div className="flex items-center justify-between text-[13px] py-0.5">
              <span className="text-[#4b4b47]">Маржа тарифа</span>
              <span className="font-mono text-[#111110]">{fin.marginPct}%</span>
            </div>
            <div className="flex items-center justify-between text-[13px] py-0.5">
              <span className="text-[#4b4b47]">Налог</span>
              <span className="font-mono text-[#111110]">{fin.taxPct}%</span>
            </div>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5">
              <span className="text-[#4b4b47]">Маржа модели {model.code}</span>
              <NumInput value={kit.margin ?? 0} onChange={v => editKit(k => { if (v > 0) k.margin = v; else delete k.margin })} suffix="%" w={64} />
            </label>
            <p className="text-[11px] text-[#9a9a95] mt-1">
              0 — берётся маржа тарифа. Минимум {fin.minMarginPct}%. Источник: {fin.source}.
              Меняются в разделе финансовых настроек, здесь только для этой модели.
            </p>
          </Card>

          <Card title="Работы и логистика">
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Монтаж за секцию</span><NumInput value={cur.rates.installPerSection} onChange={v => edit(s => { s.rates.installPerSection = v })} /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Доставка Москва</span><NumInput value={cur.rates.deliveryMoscow} onChange={v => edit(s => { s.rates.deliveryMoscow = v })} /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Подъём за этаж</span><NumInput value={cur.rates.liftPerFloor} onChange={v => edit(s => { s.rates.liftPerFloor = v })} /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Пропил (отход на рез)</span><NumInput value={cur.rates.kerf ?? 0} onChange={v => edit(s => { s.rates.kerf = v })} suffix="мм" /></label>
            <label className="flex items-center justify-between gap-2 text-[13px] py-0.5"><span className="text-[#4b4b47]">Запас заглушки по двери</span><NumInput value={cur.rates.capMargin ?? CAP_MARGIN_MM} onChange={v => edit(s => { s.rates.capMargin = v })} suffix="мм" /></label>
          </Card>

          <Card title="Зоны доставки">
            <p className="text-[12px] text-[#9a9a95] mb-2">Первая зона, чей лимит км ≥ введённого, и берётся. Пусто — только Москва по ставке выше.</p>
            {(cur.rates.deliveryZones ?? []).map((z, zi) => (
              <div key={zi} className="flex items-center gap-1.5 py-1 border-b border-[#f4f4f0] last:border-0">
                <input value={z.label} onChange={e => edit(s => { s.rates.deliveryZones![zi].label = e.target.value })}
                  className="flex-1 min-w-0 text-[13px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 outline-none focus:border-[#111110]" />
                <NumInput value={z.base} onChange={v => edit(s => { s.rates.deliveryZones![zi].base = v })} w={72} />
                <NumInput value={z.perKm ?? 0} onChange={v => edit(s => { s.rates.deliveryZones![zi].perKm = v })} w={56} suffix="₽/км" />
                <NumInput value={z.maxKm ?? 0} onChange={v => edit(s => { s.rates.deliveryZones![zi].maxKm = v || undefined })} w={56} suffix="км" />
                <button onClick={() => edit(s => { s.rates.deliveryZones!.splice(zi, 1) })} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-1">×</button>
              </div>
            ))}
            <button onClick={() => edit(s => { s.rates.deliveryZones = [...(s.rates.deliveryZones ?? []), { id: uid('z'), label: 'Новая зона', base: 0 }] })}
              className="text-[12px] text-[#4b6ea9] hover:underline mt-1">+ зона</button>
          </Card>

          <Card title="Надбавки за монтаж">
            <p className="text-[12px] text-[#9a9a95] mb-2">Сложная стена — за секцию, разовые (лестница, нестандарт) — за заказ. Менеджер отмечает при просчёте.</p>
            {(cur.rates.installSurcharges ?? []).map((f, fi) => (
              <div key={fi} className="flex items-center gap-1.5 py-1 border-b border-[#f4f4f0] last:border-0">
                <input value={f.label} onChange={e => edit(s => { s.rates.installSurcharges![fi].label = e.target.value })}
                  className="flex-1 min-w-0 text-[13px] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 outline-none focus:border-[#111110]" />
                <select value={f.kind} onChange={e => edit(s => { s.rates.installSurcharges![fi].kind = e.target.value as 'per-section' | 'per-order' })}
                  className="text-[11px] border border-[#e4e4e0] rounded-md px-1 py-0.5 text-[#6b6b66] outline-none focus:border-[#111110]">
                  <option value="per-section">за секцию</option>
                  <option value="per-order">за заказ</option>
                </select>
                <NumInput value={f.amount} onChange={v => edit(s => { s.rates.installSurcharges![fi].amount = v })} w={72} />
                <button onClick={() => edit(s => { s.rates.installSurcharges!.splice(fi, 1) })} className="text-[#c4c4be] hover:text-[#b04a3f] text-[15px] leading-none px-1">×</button>
              </div>
            ))}
            <button onClick={() => edit(s => { s.rates.installSurcharges = [...(s.rates.installSurcharges ?? []), { id: uid('f'), label: 'Новая надбавка', kind: 'per-order', amount: 0 }] })}
              className="text-[12px] text-[#4b6ea9] hover:underline mt-1">+ надбавка</button>
          </Card>
        </div>
      </div>

      {picker && <CatalogPicker onPick={applyPick} onClose={() => setPicker(null)} />}
    </div>
  )
}

// Правило количества: из геометрии / фикс / выбор клиента. Больше нигде количество не вводится.
function QtyRuleEditor({ rule, onChange }: { rule: QtyRule; onChange: (r: QtyRule) => void }) {
  return (
    <span className="flex items-center gap-1">
      <select value={rule.mode} onChange={e => {
        const m = e.target.value
        onChange(m === 'fixed' ? { mode: 'fixed', n: 1 } : m === 'client' ? { mode: 'client', options: [2, 3], def: 2 } : { mode: 'role' })
      }} className="text-[11px] border border-[#e4e4e0] rounded-md px-1 py-0.5 text-[#6b6b66] outline-none focus:border-[#111110]">
        <option value="role">кол-во из геометрии</option>
        <option value="fixed">фиксированное</option>
        <option value="client">выбор клиента</option>
      </select>
      {rule.mode === 'fixed' && (
        <input type="text" inputMode="numeric" value={rule.n} onChange={e => onChange({ mode: 'fixed', n: Number(e.target.value.replace(/\D/g, '')) || 0 })}
          className="w-12 text-right font-mono text-[11px] border border-[#e4e4e0] rounded-md px-1 py-0.5 outline-none focus:border-[#111110]" />
      )}
      {rule.mode === 'client' && (
        <input value={rule.options.join(',')} onChange={e => {
          const options = e.target.value.split(',').map(s => Number(s.trim())).filter(n => n > 0)
          onChange({ mode: 'client', options, def: options.includes(rule.def) ? rule.def : (options[0] ?? 1) })
        }} title="Через запятую: какие количества предложить клиенту"
          className="w-16 text-center font-mono text-[11px] border border-[#e4e4e0] rounded-md px-1 py-0.5 outline-none focus:border-[#111110]" />
      )}
    </span>
  )
}

function defaultDims(code: string) {
  const c = getModel(code).constraints
  const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
  return {
    width: mid(c.width),
    height: Math.min(2000, c.height[1]),
    width2: c.needsWidth2 && c.width2 ? mid(c.width2) : undefined,
    doorWidth: c.doorWidth ? mid(c.doorWidth) : undefined,
  }
}
