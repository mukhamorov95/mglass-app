'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useCanViewMoney } from '@/lib/useCanViewMoney'
import { launchedOrders } from '@/lib/liveOrders'

// Отток по действующим клиентам. Новые клиенты маскируют потери: в сумме рост,
// а внутри — база утекает. Здесь только те, кто уже покупал.
//
// Считаем по ЗАПУЩЕННЫМ в работу заказам (launchedOrders), а не по всем живым:
// просчёт — это намерение, а не покупка, и клиент, который прислал просчёты и
// не запустил, не «покупал больше». На грязных данных (архивные + просчёты)
// экран завышал потери примерно в 10 раз и показывал в риске клиентов, у
// которых потерь нет вообще.
//
// Падение заказов и падение чека — РАЗНЫЕ диагнозы. «Реже заказывает» — это про
// отношения и сервис. «Чек упал» при том же числе заказов — крупные позиции ушли
// к конкуренту, остались мелочи: это про цену и возможности производства.
// Разговор в этих двух случаях нужен разный, поэтому бакет подписан словами.

// Один клиент = несколько юрлиц. Подстрокой такое не склеить (ВРНГЛАЗИЕРС и
// ООО МОНАРХ текстуально не пересекаются с MR GLASS), поэтому список ведётся
// РУКАМИ и пополняется по мере обнаружения. Группа MR GLASS подтверждена
// владельцем; см. тот же комментарий в app/production-app/voronezh/page.tsx.
const CLIENT_ALIASES: Record<string, string> = {
  'MR GLASS (ООО ЛЮДИ)': 'MR GLASS',
  'ВРНГЛАЗИЕРС': 'MR GLASS',
  'ООО МОНАРХ': 'MR GLASS',
  'ООО ЛЮДИ': 'MR GLASS',
}

type OrderRow = {
  client_name: string | null
  created_at: string
  total_after_discount: number | null
  total_sale_inc_vat: number | null
}

type Bucket = 'gone' | 'leaving' | 'check' | 'rarer' | 'declining' | 'growing' | 'stable'

type Client = {
  name: string
  sources: string[]
  byAlias: boolean
  ord90: number; ordPrev: number
  rev90: number; revPrev: number
  avg90: number; avgPrev: number
  lastOrder: number
  daysSilent: number
  lost: number
  bucket: Bucket
}

const BUCKETS: Record<Bucket, { label: string; cls: string }> = {
  gone:    { label: 'Ушёл',            cls: 'bg-red-50 text-red-700 border-red-200' },
  leaving: { label: 'Уходит',          cls: 'bg-red-50 text-red-700 border-red-200' },
  check:   { label: 'Чек упал',        cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  rarer:   { label: 'Реже заказывает', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  declining: { label: 'Снижение',      cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  growing: { label: 'Растёт',          cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  stable:  { label: 'Стабильно',       cls: 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]' },
}

const RISK: Bucket[] = ['gone', 'leaving', 'check', 'rarer', 'declining']

const RUB_RAW = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const rub = (n: number, can: boolean | null) => can ? RUB_RAW(n) : '—'
const signedRub = (n: number, can: boolean | null) => can ? (n >= 0 ? '−' : '+') + RUB_RAW(Math.abs(n)) : '—'

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
const daysWord = (n: number) => `${n} ${plural(n, 'день', 'дня', 'дней')}`
const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })

const timesWord = (k: number) => {
  const r = Math.round(k * 10) / 10
  if (Math.abs(r - 2) < 0.15) return 'вдвое'
  if (Math.abs(r - 3) < 0.15) return 'втрое'
  if (Math.abs(r - 4) < 0.15) return 'вчетверо'
  return `в ${r.toLocaleString('ru-RU')} раза`
}

// ─── склейка имён ───────────────────────────────────────────────────────────
const flat = (s: string) => s.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim().toUpperCase()
const tokensOf = (s: string) => flat(s.replace(/\([^)]*\)/g, ' ').replace(/[«»"'.,\-–—]/g, ' ')).split(' ').filter(Boolean)

// «ИП Гапонов» внутри «ИП ГАПОНОВ ЕВГЕНИЙ ВАЛЕРЬЕВИЧ». Короткое имя должно быть
// хотя бы из двух слов — иначе «Сергей» проглотит и «Сергей Витраж», и «СЕРГЕЙ GG».
const contains = (long: string[], short: string[]) => ` ${long.join(' ')} `.includes(` ${short.join(' ')} `)

// «ИП Горбова Е.С» = «ИП Горбова Елена Сергеевна»: столько же слов, каждое —
// префикс своей пары, и хотя бы одно реально сокращено до инициала.
const initialsMatch = (a: string[], b: string[]) => {
  if (a.length !== b.length || a.length < 2) return false
  let abbrev = false
  for (let i = 0; i < a.length; i++) {
    const [x, y] = a[i].length <= b[i].length ? [a[i], b[i]] : [b[i], a[i]]
    if (!y.startsWith(x)) return false
    if (x.length !== y.length) abbrev = true
  }
  return abbrev
}

function buildGroups(names: string[]): Map<string, { display: string; sources: string[]; byAlias: boolean }> {
  // Шаг 1 — псевдонимы владельца.
  const keyed = new Map<string, { sources: string[]; byAlias: boolean }>()
  for (const raw of names) {
    const alias = CLIENT_ALIASES[flat(raw)]
    const key = alias ?? flat(raw)
    const g = keyed.get(key) ?? { sources: [], byAlias: false }
    g.sources.push(raw)
    if (alias) g.byAlias = true
    keyed.set(key, g)
  }

  // Шаг 2 — эвристика по подстроке и инициалам поверх уже склеенного.
  const keys = [...keyed.keys()]
  const parent = new Map(keys.map(k => [k, k]))
  const find = (k: string): string => { let c = k; while (parent.get(c) !== c) c = parent.get(c)!; return c }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const A = tokensOf(keys[i]), B = tokensOf(keys[j])
      if (!A.length || !B.length) continue
      const [s, l] = A.length <= B.length ? [A, B] : [B, A]
      const hit = (s.length >= 2 && s.length < l.length && contains(l, s)) || initialsMatch(A, B)
      if (!hit) continue
      const [x, y] = [find(keys[i]), find(keys[j])]
      if (x !== y) parent.set(x, y)
    }
  }

  const out = new Map<string, { display: string; sources: string[]; byAlias: boolean }>()
  for (const k of keys) {
    const root = find(k)
    const g = out.get(root) ?? { display: '', sources: [], byAlias: false }
    const src = keyed.get(k)!
    g.sources.push(...src.sources)
    g.byAlias = g.byAlias || src.byAlias
    out.set(root, g)
  }
  for (const [root, g] of out) {
    // Псевдоним владельца важнее самого длинного имени: группа зовётся MR GLASS.
    const alias = g.sources.map(s => CLIENT_ALIASES[flat(s)]).find(Boolean)
    g.display = alias ?? (g.byAlias ? root : g.sources.slice().sort((a, b) => b.length - a.length)[0])
    g.sources.sort((a, b) => a.localeCompare(b, 'ru'))
    out.set(root, g)
  }
  return out
}

// Порог «заметной» потери: ниже него колебания — шум, выше — разговор.
const NOTABLE_LOSS_PER_MONTH = 30_000

function classify(c: Omit<Client, 'bucket'>): Bucket {
  if (c.ord90 === 0 && c.ordPrev > 0) return 'gone'
  // «Растёт» проверяем ДО признаков риска: клиент, у которого выручка выросла,
  // не может быть в списке потерь, даже если формально стал заказывать реже.
  if (c.rev90 > c.revPrev * 1.1) return 'growing'
  if (c.daysSilent >= 21 && c.rev90 < c.revPrev * 0.8) return 'leaving'
  if (c.avg90 < c.avgPrev * 0.7 && c.ord90 >= c.ordPrev * 0.8) return 'check'
  if (c.ord90 < c.ordPrev * 0.7 && c.avg90 >= c.avgPrev * 0.8) return 'rarer'
  // Страховка: клиент может не попасть ни в один точный признак и всё равно
  // терять заметные деньги (GlassLuxury: 34→24 заказа и чек −25%, каждый
  // порог пройден чуть-чуть). Экран, который прячет потерю 139 тыс/мес,
  // не выполняет свою работу — поэтому ловим по сумме.
  if ((c.revPrev - c.rev90) / 3 >= NOTABLE_LOSS_PER_MONTH) return 'declining'
  return 'stable'
}

function diagnosis(c: Client): string {
  const ordK = c.ord90 > 0 ? c.ordPrev / c.ord90 : 0
  const avgK = c.avg90 > 0 ? c.avgPrev / c.avg90 : 0
  switch (c.bucket) {
    case 'gone':
      return `Ни одного заказа за 90 дней — до этого было ${c.ordPrev}. Молчит ${daysWord(c.daysSilent)}: клиент потерян, если не позвонить.`
    case 'leaving':
      return `Заказов и денег стало меньше, и уже ${daysWord(c.daysSilent)} тишины. Уходит — это разговор про отношения и сервис, не про цену.`
    case 'check':
      return `Заказывает так же часто (${c.ordPrev} → ${c.ord90}), но чек упал ${timesWord(avgK)} — крупные заказы ушли к конкуренту, остались мелкие. Разговор про цену и возможности, не про сервис.`
    case 'rarer': {
      const chek = c.avg90 > c.avgPrev * 1.1 ? 'чек при этом даже вырос' : 'при том же чеке'
      return `Заказов ${timesWord(ordK)} меньше (${c.ordPrev} → ${c.ord90}), ${chek} — теряем не цену, а объём. Разговор про то, почему перестал приходить.`
    }
    case 'declining':
      return `Заказы ${c.ordPrev} → ${c.ord90}, чек ${c.avgPrev > c.avg90 ? 'ниже' : 'выше'} — ни один признак не сработал резко, но деньги уходят. Просели понемногу по всем фронтам: стоит выяснить причину, пока не стало «уходит».`
    case 'growing':
      return c.ordPrev === 0
        ? `Новый в базе: ${c.ord90} ${plural(c.ord90, 'заказ', 'заказа', 'заказов')} за 90 дней.`
        : `Заказы ${c.ordPrev} → ${c.ord90}, выручка выросла. Поблагодарить и закрепить.`
    default:
      return ''
  }
}

export default function ChurnPage() {
  const sb = createClient()
  const canMoney = useCanViewMoney()
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<OrderRow[]>([])
  const [now, setNow] = useState(0)
  const [showGrowing, setShowGrowing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const at = Date.now()
    const since = new Date(at - 180 * 86400000).toISOString()
    const acc: OrderRow[] = []
    for (let from = 0; ; from += 1000) {
      // Только живые: с архивными дублями импорта оборот за 180 дней был 70,5 млн
      // вместо 22,6 млн, и вердикты «ушёл / растёт» строились на утроенных суммах.
      const { data, error } = await launchedOrders(sb, 'client_name,created_at,total_after_discount,total_sale_inc_vat')
        .gte('created_at', since)
        .order('created_at', { ascending: false }).range(from, from + 999)
      if (error || !data?.length) break
      acc.push(...(data as unknown as OrderRow[]))
      if (data.length < 1000) break
    }
    setNow(at)
    setRows(acc)
    setLoading(false)
  }, [sb])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().catch(() => setLoading(false)) }, [load])

  const clients = useMemo<Client[]>(() => {
    const d90 = now - 90 * 86400000
    const d180 = now - 180 * 86400000

    // client_id пустой примерно на трети строк — группируем по имени.
    // M GLASS — собственная розница компании, а не клиент.
    const usable = rows.filter(r => {
      const n = (r.client_name ?? '').trim()
      return n.length > 0 && !/^M\s*GLASS$/i.test(n)
    })

    const groups = buildGroups([...new Set(usable.map(r => (r.client_name ?? '').trim()))])
    const keyOf = new Map<string, string>()
    for (const [root, g] of groups) for (const s of g.sources) keyOf.set(s, root)

    const agg = new Map<string, { ord90: number; ordPrev: number; rev90: number; revPrev: number; last: number }>()
    for (const r of usable) {
      const key = keyOf.get((r.client_name ?? '').trim())
      if (!key) continue
      const t = new Date(r.created_at).getTime()
      if (isNaN(t) || t < d180) continue
      const val = Number(r.total_after_discount ?? r.total_sale_inc_vat ?? 0) || 0
      const a = agg.get(key) ?? { ord90: 0, ordPrev: 0, rev90: 0, revPrev: 0, last: 0 }
      if (t >= d90) { a.ord90++; a.rev90 += val } else { a.ordPrev++; a.revPrev += val }
      if (t > a.last) a.last = t
      agg.set(key, a)
    }

    const out: Client[] = []
    for (const [key, a] of agg) {
      const g = groups.get(key)!
      const base = {
        name: g.display,
        sources: g.sources,
        byAlias: g.byAlias,
        ord90: a.ord90, ordPrev: a.ordPrev,
        rev90: a.rev90, revPrev: a.revPrev,
        avg90: a.ord90 > 0 ? a.rev90 / a.ord90 : 0,
        avgPrev: a.ordPrev > 0 ? a.revPrev / a.ordPrev : 0,
        lastOrder: a.last,
        daysSilent: Math.floor((now - a.last) / 86400000),
        lost: (a.revPrev - a.rev90) / 3,
      }
      out.push({ ...base, bucket: classify(base) })
    }
    return out
  }, [rows, now])

  const risk = useMemo(
    () => clients.filter(c => RISK.includes(c.bucket)).sort((a, b) => (b.revPrev - b.rev90) - (a.revPrev - a.rev90)),
    [clients],
  )
  const growing = useMemo(
    () => clients.filter(c => c.bucket === 'growing').sort((a, b) => (b.rev90 - b.revPrev) - (a.rev90 - a.revPrev)),
    [clients],
  )
  const merged = useMemo(
    () => [...new Map(clients.map(c => [c.name, c])).values()].filter(c => c.sources.length > 1),
    [clients],
  )

  const lostPerMonth = risk.reduce((s, c) => s + c.lost, 0)
  const goneCount = risk.filter(c => c.bucket === 'gone').length
  const stableCount = clients.filter(c => c.bucket === 'stable').length

  if (loading) return (
    <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center text-[13px] text-[#9a9a95]">Загрузка...</div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">📉 Отток клиентов</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">
          Это деньги, которые уже были заработаны и утекают, а не недополученная новая выручка. Новые клиенты закрывают потерю в общей цифре — здесь её видно отдельно.
        </p>
      </div>

      <div className="px-4 pt-4 max-w-[1100px]">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Теряем в месяц</p>
            <p className={`text-[22px] font-bold font-mono mt-0.5 ${lostPerMonth > 0 ? 'text-red-600' : 'text-[#111110]'}`}>{rub(lostPerMonth, canMoney)}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Клиентов в риске</p>
            <p className="text-[22px] font-bold text-[#111110] mt-0.5">{risk.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3">
            <p className="text-[11px] uppercase tracking-wide text-[#9a9a95]">Из них ушли совсем</p>
            <p className={`text-[22px] font-bold mt-0.5 ${goneCount > 0 ? 'text-red-600' : 'text-[#111110]'}`}>{goneCount}</p>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-3">
          <p className="text-[12px] font-semibold text-amber-900">⚠️ Список псевдонимов ведётся вручную</p>
          <p className="text-[12px] text-amber-800 mt-0.5">
            Если клиент сменил юрлицо и его нет в списке — он ошибочно попадёт в «ушёл», а новое юрлицо будет выглядеть новым клиентом. Сообщите, чтобы добавить.
          </p>
        </div>

        {merged.length > 0 && (
          <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 mb-4">
            <p className="text-[12px] font-semibold text-[#111110]">Имена, склеенные в одного клиента — проверьте</p>
            <div className="mt-1.5 space-y-1">
              {merged.map(c => (
                <p key={c.name} className="text-[12px] text-[#6b6b66]">
                  <span className="font-semibold text-[#111110]">{c.name}</span>
                  <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded border ${c.byAlias ? 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                    {c.byAlias ? 'список владельца' : 'по совпадению имён'}
                  </span>
                  <span className="block text-[#9a9a95]">← {c.sources.join(' · ')}</span>
                </p>
              ))}
            </div>
          </div>
        )}

        <p className="text-[11px] text-[#9a9a95] mb-2">
          Последние 90 дней против предыдущих 90. Сумма заказа — с учётом скидки. Собственная розница M GLASS не считается клиентом.
          Ещё {stableCount} {plural(stableCount, 'клиент', 'клиента', 'клиентов')} без заметных изменений — не показываем.
        </p>

        <div className="space-y-2">
          {risk.length === 0 && (
            <div className="bg-white rounded-xl border border-[#e4e4e0] p-6 text-center">
              <p className="text-[13px] text-[#9a9a95]">Клиентов в риске нет</p>
            </div>
          )}
          {risk.map(c => <ClientCard key={c.name} c={c} canMoney={canMoney} />)}
        </div>

        <div className="mt-4">
          <button onClick={() => setShowGrowing(v => !v)}
            className="w-full bg-white rounded-xl border border-[#e4e4e0] px-4 py-3 flex items-center justify-between text-left hover:border-[#111110] transition-colors">
            <span>
              <span className="text-[13px] font-semibold text-emerald-700">📈 Растут · {growing.length}</span>
              <span className="block text-[11px] text-[#9a9a95] mt-0.5">Кого стоит поблагодарить, пока занимаемся теми, кто уходит</span>
            </span>
            <span className="text-[13px] text-[#9a9a95]">{showGrowing ? '−' : '+'}</span>
          </button>
          {showGrowing && (
            <div className="space-y-2 mt-2">
              {growing.map(c => <ClientCard key={c.name} c={c} canMoney={canMoney} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ClientCard({ c, canMoney }: { c: Client; canMoney: boolean | null }) {
  const b = BUCKETS[c.bucket]
  const up = c.bucket === 'growing'

  return (
    <div className={`rounded-xl border bg-white px-4 py-3 ${c.bucket === 'gone' || c.bucket === 'leaving' ? 'border-red-300' : 'border-[#e4e4e0]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[#111110]">{c.name}</p>
          {c.sources.length > 1 && (
            <p className="text-[10px] text-[#9a9a95] mt-0.5">склеено: {c.sources.join(' · ')}</p>
          )}
        </div>
        <span className={`flex-shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 mt-2.5">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[#9a9a95]">Заказы</p>
          <p className="text-[13px] font-mono text-[#111110]">
            {c.ordPrev} <span className="text-[#9a9a95]">→</span> <span className="font-semibold">{c.ord90}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[#9a9a95]">Средний чек</p>
          <p className="text-[13px] font-mono text-[#111110]">
            {rub(c.avgPrev, canMoney)} <span className="text-[#9a9a95]">→</span> <span className="font-semibold">{rub(c.avg90, canMoney)}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[#9a9a95]">{up ? 'Прибавка в месяц' : 'Потеря в месяц'}</p>
          <p className={`text-[13px] font-mono font-semibold ${c.lost > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {signedRub(c.lost, canMoney)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[#9a9a95]">Последний заказ</p>
          <p className="text-[13px] font-mono text-[#111110]">
            {fmtDate(c.lastOrder)} <span className={c.daysSilent >= 21 ? 'text-red-600 font-semibold' : 'text-[#9a9a95]'}>· {daysWord(c.daysSilent)}</span>
          </p>
        </div>
      </div>

      <p className="text-[12px] text-[#111110] mt-2.5">{diagnosis(c)}</p>
    </div>
  )
}
