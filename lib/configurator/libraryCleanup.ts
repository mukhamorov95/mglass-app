import { ROLE_META, type Library, type LibraryItem, type ModelKit, type KitEntry } from '@/lib/configurator/kit'
import type { CatalogRef, PriceByColor, BarStock } from '@/lib/configurator/pricing'

// Чистка библиотеки позиций. Пикер годами заводил новую позицию на каждый выбор, и одна
// деталь жила 6–9 копиями: общий раскрой на заказ их не объединял (ключ — id позиции),
// а переоценка правила копии вразнобой. Здесь копии склеиваются в одну позицию, ссылки
// комплектов переводятся на неё, ничего в составе моделей не меняется.

const refOf = (it: LibraryItem): CatalogRef | undefined => it.ref ?? it.stocks?.find(s => s.ref)?.ref

// Одна деталь = роль + поставщик + база артикула (материал входит в базу). Хлысты разной
// длины (FDPA-55.22 и FDPA-55.3) здесь не склеиваются: длины в одну позицию собирает пикер.
export function itemKey(it: LibraryItem): string {
  const ref = refOf(it)
  return ref?.supplier && ref.base
    ? `${it.role}|${ref.supplier}|${ref.base}`
    : `${it.role}|—|${it.name.trim().toLowerCase()}`
}

const artToken = (s: string) => s.match(/\bFD[A-Z]+-\d+(?:\.\d+)?/)?.[0] ?? null

// Ссылка ведёт на другую деталь, чем названа позиция («Держатель FDC-35», ссылка FDC-33):
// так бывает, когда в существующую позицию подтянули цены чужой строки. Название пишется
// при создании и с тех пор не меняется, поэтому верим ему.
export function refMismatch(it: LibraryItem): { from: string; to: string } | null {
  const ref = it.ref
  if (!ref?.base || ref.supplier !== 'av24') return null
  const nameTok = artToken(it.name)
  const baseTok = ref.base.split(' ')[0]
  if (!nameTok || !baseTok) return null
  if (baseTok === nameTok || baseTok.startsWith(nameTok + '.') || baseTok.startsWith(nameTok + '-')) return null
  const material = ref.base.split(' ').slice(1).join(' ')
  return { from: ref.base, to: material ? `${nameTok} ${material}` : nameTok }
}

export const isDefectItem = (it: LibraryItem) =>
  /-DEF\b/i.test(refOf(it)?.base ?? '') || /дефект|уценк/i.test(it.name)

const pricedCount = (it: LibraryItem) =>
  Object.keys(it.prices ?? {}).length + (it.stocks ?? []).reduce((s, st) => s + Object.keys(st.prices ?? {}).length, 0)

const fill = (a: PriceByColor | undefined, b: PriceByColor | undefined): PriceByColor => ({ ...(b ?? {}), ...(a ?? {}) })

function mergeStocks(a: BarStock[] = [], b: BarStock[] = []): BarStock[] {
  const out = a.map(s => ({ ...s, prices: { ...s.prices } }))
  for (const s of b) {
    const same = out.find(x => x.len === s.len)
    if (same) { same.prices = fill(same.prices, s.prices); same.ref ??= s.ref }
    else out.push({ ...s, prices: { ...s.prices } })
  }
  return out.sort((x, y) => x.len - y.len)
}

export type CleanupReport = {
  refFixed: { itemId: string; name: string; from: string; to: string }[]
  merged: { key: string; keep: string; removed: string[] }[]
  dropped: { itemId: string; name: string; why: string }[]
  entriesRepointed: number
}

type Kits = Record<string, ModelKit>

function usage(kits: Kits): Map<string, number> {
  const m = new Map<string, number>()
  for (const k of Object.values(kits)) for (const s of k.slots) for (const e of s.entries) m.set(e.itemId, (m.get(e.itemId) ?? 0) + 1)
  return m
}

export function cleanupLibrary(library: Library, kits: Kits): { library: Library; kits: Kits; report: CleanupReport } {
  const report: CleanupReport = { refFixed: [], merged: [], dropped: [], entriesRepointed: 0 }
  const items: LibraryItem[] = library.items.map(i => structuredClone(i))

  for (const it of items) {
    const mm = refMismatch(it)
    if (!mm || !it.ref) continue
    it.ref = { ...it.ref, base: mm.to }
    report.refFixed.push({ itemId: it.id, name: it.name, ...mm })
  }

  const used = usage(kits)
  const groups = new Map<string, LibraryItem[]>()
  for (const it of items) groups.set(itemKey(it), [...(groups.get(itemKey(it)) ?? []), it])

  const alias = new Map<string, string>()
  const keep: LibraryItem[] = []
  for (const [key, group] of groups) {
    // Позиция с исправленной ссылкой несла цены чужой строки — она не главная, её цены
    // заполняют только пустые цвета.
    const suspect = (it: LibraryItem) => (report.refFixed.some(r => r.itemId === it.id) ? 1 : 0)
    const ranked = [...group].sort((a, b) =>
      suspect(a) - suspect(b) || (used.get(b.id) ?? 0) - (used.get(a.id) ?? 0) || pricedCount(b) - pricedCount(a))
    const head = ranked[0]
    for (const other of ranked.slice(1)) {
      if (ROLE_META[head.role].kind === 'bar') head.stocks = mergeStocks(head.stocks, other.stocks)
      else head.prices = fill(head.prices, other.prices)
      head.image ??= other.image
      head.specs ??= other.specs
      head.shape ??= other.shape
      alias.set(other.id, head.id)
    }
    if (ranked.length > 1) report.merged.push({ key, keep: head.id, removed: ranked.slice(1).map(i => i.id) })
    keep.push(head)
  }

  const nextKits: Kits = {}
  for (const [code, kit] of Object.entries(kits)) {
    const k = structuredClone(kit)
    for (const slot of k.slots) {
      const seen = new Map<string, KitEntry>()
      const entries: KitEntry[] = []
      for (const e of slot.entries) {
        const id = alias.get(e.itemId) ?? e.itemId
        if (id !== e.itemId) report.entriesRepointed += 1
        const prev = seen.get(id)
        if (prev) { if (e.primary) prev.primary = true; continue }
        const ne = { ...e, itemId: id }
        seen.set(id, ne)
        entries.push(ne)
      }
      slot.entries = entries
    }
    nextKits[code] = k
  }

  const stillUsed = usage(nextKits)
  const final = keep.filter(it => {
    if (isDefectItem(it) && !stillUsed.get(it.id)) {
      report.dropped.push({ itemId: it.id, name: it.name, why: 'уценка с дефектом, ни в одной модели' })
      return false
    }
    return true
  })
  return { library: { items: final }, kits: nextKits, report }
}

// Ходовая позиция — дополнительным вариантом в слот роли, без ★: умолчание модели и цены
// сайта не меняются, а менеджер и клиент могут выбрать её в слоте. Та же деталь в библиотеке
// уже есть — берём её; слота под роль в модели нет — не создаём (состав модели решает владелец).
// В слот «работают все» не кладём: там записи складываются, и вариант молча поднял бы цену.
export function addVariant(library: Library, kits: Kits, codes: string[], item: LibraryItem): { library: Library; kits: Kits; added: string[] } {
  const key = itemKey(item)
  const existing = library.items.find(i => itemKey(i) === key)
  const lib: Library = existing ? library : { items: [...library.items, item] }
  const id = existing?.id ?? item.id
  const next: Kits = { ...kits }
  const added: string[] = []
  const slotOf = (kit: ModelKit) => kit.slots.find(s => s.role === item.role && s.select === 'one')
  for (const code of codes) {
    const kit = kits[code]
    const slot = kit && slotOf(kit)
    if (!kit || !slot || slot.entries.some(e => e.itemId === id)) continue
    const k = structuredClone(kit)
    slotOf(k)!.entries.push({ itemId: id, qty: { mode: 'role' } })
    next[code] = k
    added.push(code)
  }
  return { library: lib, kits: next, added }
}

