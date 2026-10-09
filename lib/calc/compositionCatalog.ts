import { FINISH_IDS } from '@/lib/configurator/pricing'
import { articleBase, isDefectRow, rowCost, type SupplierRowLike } from '@/lib/supplier/colorCode'
import { ARTICLE_RE, axisOf, pickRow, stockLengthMm, type CompositionRole, type Supplier } from '@/lib/calc/composition'
import { pickVetroRow, VETRO_BASE_RE, vetroBase, vetroModelName } from '@/lib/calc/vetroRows'

// Каталог конструктора (CONSTRUCTOR_ROUTE.md, К1, К5): разделы АВ24 и Ветро для душевых →
// модели с фото и закупкой по цвету. Модель = база артикула без кода цвета («FDP-230 BR»,
// «Dessau-103»): менеджер выбирает модель, цвет приходит из цвета фурнитуры изделия. Цена
// модели по цвету берётся тем же выбором строки, что и в расчёте, — карточка и итог не расходятся.

type FinishId = typeof FINISH_IDS[number]

export type CatalogGroupId = 'hinge' | 'connector' | 'handle' | 'stabilizer' | 'seal' | 'threshold' | 'profile' | 'sliding' | 'other'

type Group = {
  id: CatalogGroupId
  label: string
  piece: CompositionRole                 // роль штучной позиции раздела
  linear?: CompositionRole               // роль, если длина полосы читается из названия
  categories: string[]                   // разделы АВ24
  vetro?: string[]                       // разделы Ветро
  only?: Record<string, RegExp>          // из смешанного раздела — только позиции с таким названием
}

export const CATALOG_GROUPS: Group[] = [
  // Латунные петли Афродита, Аврора, Майя, Гера (FDP-230 из заказа 0014-6, FDP-232 из 3D)
  // АВ24 держит в разделе саун — рядом с ручками для саун, которые душевой не нужны.
  { id: 'hinge', label: 'Петли', piece: 'hinge', categories: [
    'Премиум петли для душевых', 'Стандартные петли для душевых', 'Эконом класс петель для душевых',
    'Петли с подъемным механизмом', 'Петли для душевых', 'Фурнитура для саун, бань и хамам'],
    vetro: ['Петли для душевых'],
    only: { 'Фурнитура для саун, бань и хамам': /^петля/i } },
  { id: 'connector', label: 'Коннекторы', piece: 'connector', categories: [
    'Стандартные коннекторы для душевых', 'Премиум коннекторы для душевых', 'Эконом класс коннекторов для душевых',
    'Коннекторы для душевых', 'Верхние коннекторы для душевых Орион.', 'Коннекторы для стеклянных перегородок',
    'Стеклодержатели со шпилькой'],
    vetro: ['Коннекторы для крепления стекла'] },
  { id: 'handle', label: 'Ручки', piece: 'handle', categories: [
    'Ручки полотенцесушители', 'Ручки кноб', 'Ручки для стеклянных душевых', 'Ручки купе'],
    vetro: ['Ручки'] },
  { id: 'stabilizer', label: 'Стабилизаторы и трубы', piece: 'stabilizer', linear: 'profile', categories: [
    'Угловые стабилизаторы', 'Трубы 30х10 для душевых', 'Трубы 15х15 для душевых', 'Трубы диаметром 19 мм для душевых',
    'Соединители и держатели труб 30х10 мм', 'Соединители и держатели труб 15х15 мм',
    'Соединители и держатели труб Ø 19 мм', 'Регулируемые штанги для душевых'],
    vetro: ['Крепления для душевой штанги', 'Штанги'] },
  { id: 'seal', label: 'Уплотнители', piece: 'other', linear: 'seal', categories: [
    'Уплотнители 2.2 м премиум для стекла 8 мм', 'Уплотнители 2.2 м стандарт для стекла 8 мм',
    'Уплотнители 2.5 м премиум для стекла 8 мм', 'Уплотнители 2.5 м стандарт для стекла 8 мм',
    'Уплотнители с укороченной посадкой 2.5 м премиум для стекла 8 мм', 'Уплотнители 3 м премиум для стекла 8 мм',
    'Уплотнители для стекла 8 мм', 'Уплотнители для стекла 6 мм', 'Уплотнители 2.2 м премиум для стекла 10 мм',
    'Уплотнители 2.5 м премиум для стекла 10 мм', 'Уплотнители 3 м премиум для стекла 10 мм',
    'Уплотнители для стекла 10 мм', 'Самоклеющиеся уплотнители'],
    vetro: ['Уплотнители и пороги ПВХ'] },
  // Акриловый порог — расходник (прозрачный к любому цвету), алюминиевый — цвета фурнитуры.
  { id: 'threshold', label: 'Пороги', piece: 'other', linear: 'profile', categories: [
    'Акриловые порожки', 'Порожки алюминиевые Ступенька', 'Порожки алюминиевые Капля'],
    vetro: ['Пороги и соединители'] },
  { id: 'profile', label: 'Профили', piece: 'other', linear: 'profile', categories: [
    'Алюминиевый профиль для стекла 8 мм', 'Алюминиевый профиль для стекла 10 мм',
    'Профиль притвор для магнитного уплотнителя', 'Профиль из нержавеющей стали для стекла 8 мм',
    'Алюминиевый профиль 30х17 мм', 'Зажимной профиль для стекла алюминиевый 40 мм'],
    vetro: ['Профили для стекла'] },
  { id: 'sliding', label: 'Раздвижные системы', piece: 'other', categories: [
    'Душевые системы Альфа α и Бета β', 'Душевые системы FDS-3', 'Премиум душевые системы Нимфа FDS-8, FDS-9',
    'Душевые системы семейства Клио FDS-102, FDS-103', 'Ретра. Безрамочная система на стену FDS-11',
    'Тау. Система с креплением на стекло или на стену FDS-10', 'Венера. Универсальная система FDS-15',
    'Раздвижные системы для душевых', 'Безрамочная раздвижная система FDS-16', 'Раздвижные системы парящие двери FDS-21'],
    vetro: ['Раздвижные двери', 'Комплекты раздвижных душевых'] },
  { id: 'other', label: 'Прочее', piece: 'other', categories: [
    'Стопоры', 'Товары для монтажа', 'Крючки и аксессуары', 'Поручни на стекло'],
    vetro: ['Стопоры и полотенцедержатели'] },
]

export type CatalogRow = SupplierRowLike & { category: string | null; image_url?: string | null; url?: string | null; supplier?: string | null }

export type CatalogModel = {
  base: string
  supplier: Supplier
  group: CatalogGroupId
  category: string
  role: CompositionRole
  name: string
  stockMm: number | null            // у погонной позиции — длина полосы
  image: string | null
  link: string | null
  // Закупка за штуку (за полосу) и фото строки этого цвета; цвета без цены нет в объекте.
  variants: Partial<Record<FinishId, { cost: number; image?: string }>>
}

// «Ручка кноб Эхо FDR-121, нержавейка/черный» → «Ручка кноб Эхо FDR-121»: хвост
// «материал/цвет» (иногда с повтором артикула) — свойство строки, а не модели.
export function modelName(name: string): string {
  const parts = name.split(/,(?!\d)/).map(s => s.trim()).filter(Boolean)   // «2,2 м» не делим
  while (parts.length > 1 && parts[parts.length - 1].includes('/')) parts.pop()
  return parts.join(', ').replace(/\s+/g, ' ').trim()
}

// Длина в названии бывает и у штучного: «Тубус картонный, длина 2,2 м». Верхняя заглушка
// профиля («Заглушка верхняя FDPA-500.1, 1 м») — погонная: режется по ширине двери.
const NOT_LINEAR = /^(тубус|образц|коробк|упаковк)/i

// Порог-расходник: акриловый у АВ24, ПВХ у Ветро (лежит вместе с уплотнителями).
function roleOf(g: Group, category: string, linear: boolean, name: string): CompositionRole {
  if (!linear || !g.linear) return g.piece
  return category === 'Акриловые порожки' || (category === 'Уплотнители и пороги ПВХ' && /порог/i.test(name)) ? 'threshold' : g.linear
}

const supplierOf = (r: { supplier?: string | null }): Supplier => (r.supplier === 'vetro' ? 'vetro' : 'av24')
const GROUP_OF = new Map<string, Group>(CATALOG_GROUPS.flatMap(g => [
  ...g.categories.map(c => [`av24|${c}`, g] as const),
  ...(g.vetro ?? []).map(c => [`vetro|${c}`, g] as const),
]))

// Раздел конструктора, к которому относится строка прайса, или null. Его же зовёт обогащение
// фото (scripts/enrich-av24-catalog.ts) — чтобы не ходить за карточками, которых нет в каталоге.
export function catalogGroupOf(r: { category?: string | null; article: string; name?: string | null; supplier?: string | null }): Group | null {
  const g = r.category ? GROUP_OF.get(`${supplierOf(r)}|${r.category}`) : undefined
  if (!g || isDefectRow(r)) return null
  const only = g.only?.[r.category!]
  return only && !only.test(r.name ?? '') ? null : g
}

export function buildCatalog(rows: CatalogRow[]): CatalogModel[] {
  const byBase = new Map<string, { supplier: Supplier; base: string; own: CatalogRow[] }>()
  for (const r of rows) {
    if (!catalogGroupOf(r)) continue
    const supplier = supplierOf(r)
    const base = supplier === 'vetro' ? vetroBase(r.article) : articleBase('av24', r.article)
    if (!(supplier === 'vetro' ? VETRO_BASE_RE : ARTICLE_RE).test(base)) continue
    const key = `${supplier}|${base}`
    const m = byBase.get(key) ?? { supplier, base, own: [] }
    m.own.push(r)
    byBase.set(key, m)
  }

  const out: CatalogModel[] = []
  for (const { supplier, base, own } of byBase.values()) {
    const category = own[0].category!
    const g = GROUP_OF.get(`${supplier}|${category}`)!
    const named = own.find(r => r.name) ?? own[0]
    const stockRow = own.find(r => stockLengthMm(r.name) != null)
    const stockMm = g.linear && !NOT_LINEAR.test(named.name ?? '') ? stockLengthMm(stockRow?.name) : null
    const role = roleOf(g, category, stockMm != null, named.name ?? '')
    const variants: CatalogModel['variants'] = {}
    for (const f of FINISH_IDS) {
      const row = (supplier === 'vetro' ? pickVetroRow(own, axisOf(role), f) : pickRow(own, axisOf(role), f)) as CatalogRow | null
      if (!row) continue
      variants[f] = { cost: rowCost(row), ...(row.image_url ? { image: row.image_url } : {}) }
    }
    out.push({
      base, supplier, group: g.id, category, role,
      name: (supplier === 'vetro' ? vetroModelName(named.name ?? '', base) : modelName(named.name ?? base)) || base,
      stockMm,
      image: own.find(r => r.image_url)?.image_url ?? null,
      link: own.find(r => r.url)?.url ?? null,
      variants,
    })
  }
  const order = new Map(CATALOG_GROUPS.map((g, i) => [g.id, i]))
  return out.sort((a, b) => order.get(a.group)! - order.get(b.group)! || a.name.localeCompare(b.name, 'ru'))
}
