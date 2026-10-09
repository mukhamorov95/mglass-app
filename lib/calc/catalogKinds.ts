import type { CatalogModel } from '@/lib/calc/compositionCatalog'
import type { FinishId } from '@/lib/configurator/catalog'

// Разновидность детали внутри раздела каталога (CONSTRUCTOR_ROUTE.md, К9 В1): по ней выбранная
// деталь предлагает замену — кноб на кноб, петлю стекло-стекло 180° на такую же. Поля «тип» у
// поставщиков нет, читаем из названия: слова «кноб», «стена-стекло», «180°» устойчивы у обоих.

export type Kind = {
  key: string                 // для фишек каталога: одна разновидность — одна фишка
  label: string
  family: string              // раздел + вид детали: без совпадения замены нет
  mount?: string
  angle?: string
  lift?: boolean
  side?: 'L' | 'R'
  glass?: [number, number]    // под какую толщину стекла, мм (от–до)
}

type Named = Pick<CatalogModel, 'group' | 'name' | 'category'>

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[˚º]/g, '°').replace(/\s+/g, ' ')

// Угол — 0/90/135/180/360 со знаком градуса, буквой «С» («135С») или отдельным числом; число
// сразу после дефиса или буквы — часть артикула («Bsp-90», «MS-90/3000»), не угол.
const ANGLE_RE = /(?:^|[\s,(])(0|90|135|180|360)(?:\s*°|с(?![а-я])|(?=[\s,.)\-–]|$))(?:\s*[-–]\s*(90|135|180)\s*°?)?/

function angleOf(n: string): string | undefined {
  const m = n.match(ANGLE_RE)
  return m ? (m[2] ? `${m[1]}–${m[2]}°` : `${m[1]}°`) : undefined
}

function mountOf(n: string): string | undefined {
  if (/пол-стена-стекло/.test(n)) return 'пол-стена-стекло'
  if (/стена-стекло|стекло-стена/.test(n)) return 'стена-стекло'
  if (/стекло-стекло/.test(n)) return 'стекло-стекло'
  if (/стекло-порог/.test(n)) return 'стекло-порог'
  if (/осев/.test(n)) return 'осевая'
  if (/маятник/.test(n)) return 'маятниковая'
  if (/т-образн/.test(n)) return 'Т-образный'
  if (/верхн/.test(n)) return 'верхний'
  return undefined
}

function glassOf(n: string): [number, number] | undefined {
  const m = n.match(/(?:стекл[аоу]?|стекло)\s*(?:толщиной\s*)?(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s*мм/)
  if (!m) return undefined
  const a = Number(m[1]), b = Number(m[2] ?? m[1])
  return a >= 4 && b <= 20 ? [a, b] : undefined
}

// Первое слово названия — запасная разновидность: «Поручень», «Стопор», «Трек».
const firstWord = (n: string) => n.match(/[а-я]+/)?.[0] ?? ''

function handleKind(n: string): string {
  if (/купе/.test(n)) return 'купе'
  if (/саун/.test(n)) return 'для сауны'
  if (/самоклея/.test(n)) return 'самоклеящаяся'
  if (/заглушк/.test(n)) return 'заглушка'
  if (/полотенце/.test(n)) return 'полотенцесушитель'
  if (/скоб/.test(n)) return 'скоба'
  if (/кноб/.test(n)) return 'кноб'
  if (/деревян/.test(n)) return 'для сауны'
  return 'ручка'
}

function stabilizerKind(n: string): string {
  if (/угловой стабилизатор/.test(n)) return 'угловой стабилизатор'
  if (/^(\d|метр|труба|штанга)|\sштанга для|штанга регулируем/.test(n)) return 'штанга, труба'
  if (/к стене|штанги к стен/.test(n)) return 'крепление к стене'
  if (/стекл/.test(n) && /(держат|креплен|фиксатор)/.test(n)) return 'крепление к стеклу'
  if (/соедин/.test(n)) return 'соединитель'
  if (/креплен/.test(n)) return 'крепление'
  return firstWord(n) || 'прочее'
}

function sealKind(n: string): string {
  if (/магнит/.test(n)) return 'магнитный'
  if (/нижн|отбойн|капл/.test(n)) return 'нижний'
  return 'боковой'
}

function profileKind(n: string): string {
  if (/магнит/.test(n)) return 'магнитный'
  if (/заглушк|крышк|уголок|соедин/.test(n)) return 'заглушки и крышки'
  if (/зажимн/.test(n)) return 'зажимной'
  if (/уплотн/.test(n)) return 'уплотнительный'
  return 'профиль'
}

function thresholdKind(n: string): string {
  if (/^порог|порог (акрил|алюмин)/.test(n)) return 'порог'
  if (/заглушк/.test(n)) return 'заглушка'
  return 'коннектор порога'
}

function slidingKind(n: string): string {
  if (/раздвижн[а-я]* систем|комплект/.test(n)) return 'система целиком'
  return firstWord(n) || 'комплектующие'
}

const cache = new WeakMap<object, Kind>()

export function kindOf(m: Named): Kind {
  const hit = cache.get(m)
  if (hit) return hit
  const k = compute(m)
  cache.set(m, k)
  return k
}

function compute(m: Named): Kind {
  const n = norm(m.name)
  const glass = glassOf(n)
  if (m.group === 'hinge' || m.group === 'connector') {
    const mount = mountOf(n)
    const angle = angleOf(n)
    const lift = m.group === 'hinge' && /подъемн/.test(n)
    // \b в JS не видит границу у кириллицы — граница явная.
    const side = /(?:^|[\s.,(])прав|\/r$/.test(n) ? 'R' : /(?:^|[\s.,(])лев|\/l$/.test(n) ? 'L' : undefined
    const what = m.group === 'hinge' ? 'петля' : /стеклодержат/.test(n) ? 'стеклодержатель' : 'коннектор'
    const family = `${m.group}|${what}|${mount ?? ''}|${lift ? 'lift' : ''}`
    const head = mount ?? (what === 'стеклодержатель' ? 'стеклодержатель' : what)
    const label = [[head, angle].filter(Boolean).join(' '), lift && 'с подъёмом', side === 'R' ? 'правая' : side === 'L' ? 'левая' : '']
      .filter(Boolean).join(' · ')
    return { key: `${family}|${angle ?? ''}|${side ?? ''}`, label, family, mount, angle, lift, side, glass }
  }
  const sub = m.group === 'handle' ? handleKind(n)
    : m.group === 'stabilizer' ? stabilizerKind(n)
    : m.group === 'seal' ? sealKind(n)
    : m.group === 'profile' ? profileKind(n)
    : m.group === 'threshold' ? thresholdKind(n)
    : m.group === 'sliding' ? slidingKind(n)
    : firstWord(n) || 'прочее'
  // У магнитного уплотнителя угол — разновидность: 90° к стене не заменит 180° между стёклами.
  const angle = sub === 'магнитный' ? angleOf(n) : undefined
  const family = `${m.group}|${sub}`
  return { key: `${family}|${angle ?? ''}`, label: [sub, angle].filter(Boolean).join(' '), family, angle, glass }
}

const overlap = (a?: [number, number], b?: [number, number]) => !a || !b || (a[0] <= b[1] && b[0] <= a[1])

// Замена годится, если вид тот же, а угол, сторона и толщина стекла совпадают или у одной из
// деталей не указаны: «стена-стекло» без угла в названии — кандидат и для «стена-стекло 90°».
export function sameKind(a: Kind, b: Kind): boolean {
  return a.family === b.family
    && (!a.angle || !b.angle || a.angle === b.angle)
    && (!a.side || !b.side || a.side === b.side)
    && overlap(a.glass, b.glass)
}

// Чем заменить деталь: тот же раздел и вид, есть в цвете изделия, та же «погонность».
// Первыми — с фото, затем ближе по закупке к текущей (менеджер ищет замену в том же классе).
export function alternativesOf(cur: CatalogModel, models: CatalogModel[], finishId: FinishId): CatalogModel[] {
  const ck = kindOf(cur)
  const linear = cur.stockMm != null
  const base = cur.variants[finishId]?.cost
  const dist = (m: CatalogModel) => {
    const c = m.variants[finishId]!.cost
    return base && c > 0 ? Math.abs(Math.log(c / base)) : c
  }
  const photo = (m: CatalogModel) => (m.variants[finishId]?.image ?? m.image ? 1 : 0)
  return models
    .filter(m => m !== cur && m.group === cur.group && (m.stockMm != null) === linear && !!m.variants[finishId] && sameKind(ck, kindOf(m)))
    .sort((a, b) => photo(b) - photo(a) || dist(a) - dist(b) || a.name.localeCompare(b.name, 'ru'))
}
