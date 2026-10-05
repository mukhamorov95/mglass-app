'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import {
  calculateProgressiveCommission,
  DEFAULT_MANAGER_COMMISSION_TIERS,
  DEFAULT_MANAGER_SALARY_RUB,
  DEFAULT_STREAK_BONUSES,
  currentTierIndex,
  distanceToNextTier,
  type CommissionTier,
} from '@/lib/earnings/calculateProgressiveCommission'
import { cashOf, dayCommissions, payoutSplit, planProgress, monthEnd } from '@/lib/earnings/cash'
import type { CashData } from '@/lib/earnings/cashData'

// Глобальная конфигурация мотивации (одна строка в public.earnings_settings,
// scope='b2c_manager'). Загружается в useEffect; пока БД не ответила —
// рендерится с DEFAULT_* fallback'ами из lib/earnings.
type StreakBonus = { minRevenue: number; bonus: number }
type EarningsSettings = {
  baseSalaryRub:   number
  commissionTiers: CommissionTier[]
  streakBonuses:   StreakBonus[]
  effectiveFrom:   string   // YYYY-MM-DD
  rulesNote:       string
}
const EARNINGS_SETTINGS_FALLBACK: EarningsSettings = {
  baseSalaryRub:   DEFAULT_MANAGER_SALARY_RUB,
  commissionTiers: DEFAULT_MANAGER_COMMISSION_TIERS,
  streakBonuses:   DEFAULT_STREAK_BONUSES,
  effectiveFrom:   '2026-07-01',
  rulesNote: [
    'Новая система мотивации действует для B2C-заказов с 1 июля 2026 года. Доход менеджера состоит из оклада, прогрессивной комиссии и бонуса за стабильный результат.',
    '',
    'Комиссия начисляется по кассовому методу: в расчёт входит только фактически поступившая оплата по B2C-заказам менеджера. Если заказ оформлен на 500 000 ₽, но клиент внёс предоплату 250 000 ₽, в расчёт комиссии попадает только 250 000 ₽. Остаток попадёт в расчёт в том периоде, когда деньги фактически поступят в компанию.',
    '',
    'В зачёт входят предоплаты, частичные оплаты, остатки оплат, полные оплаты и доплаты по B2C-заказам, закреплённым за менеджером.',
    '',
    'Не входят в зачёт: B2B-заказы, неоплаченные заявки и КП, оформленные, но не оплаченные заказы, отменённые заказы, возвраты, спорные сделки до решения руководителя, технические пересчёты без фактического поступления денег, а также заказы с грубой ошибкой менеджера, если компания понесла убыток.',
    '',
    'Комиссия считается ступенчато: процент применяется только к сумме внутри каждого диапазона, а не ко всей выручке.',
    '',
    'Выплаты производятся два раза в месяц: 27 числа — за поступления с 1 по 15 число текущего месяца включительно; 15 числа — за поступления с 16 числа по последний день предыдущего месяца.',
    '',
    'Прогрессивная ставка считается по накопленной оплаченной B2C-выручке за календарный месяц. Если во второй половине месяца менеджер выходит на более высокую ступень, доплата рассчитывается с учётом уже начисленной комиссии за первую половину месяца.',
    '',
    'Бонус за серию начисляется только по полностью закрытым календарным месяцам. Текущий месяц входит в серию только после его завершения. Если менеджер 3 закрытых месяца подряд удерживает подтверждённую оплаченную B2C-выручку выше порога, начисляется бонус: 3 000 000 ₽ и выше каждый месяц — 20 000 ₽; 4 000 000 ₽ и выше каждый месяц — 40 000 ₽; 5 000 000 ₽ и выше каждый месяц — 60 000 ₽. Если в одном из месяцев результат ниже порога, серия по этому порогу обнуляется и начинает считаться заново.',
    '',
    'Бонус за серию выплачивается только при нормальной управленческой дисциплине: заказы заведены корректно, оплаты и документы не потеряны, нет грубых ошибок менеджера и незакрытых конфликтных ситуаций по его вине.',
    '',
    'Условия могут пересматриваться по мере роста компании, количества заявок, партнёров и заказов. Изменения правил заранее озвучиваются команде.',
  ].join('\n'),
}

// ── Types ────────────────────────────────────────────────────────────────────

// Ответ /api/my-earnings: поступления из «Аналитики дохода» (кассовый метод, М5).
type TeamRow = { amoUserId: number; name: string; plan: number | null; cash: number; payments: number }
type EarningsResponse = {
  role: string
  cash: CashData | null
  team: { month: string; bookLastDay: string | null; people: TeamRow[]; errors: string[] } | null
}

// ── Constants ────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  '2%':   'bg-gray-100 text-gray-600',
  '2.5%': 'bg-sky-50 text-sky-700',
  '3%':   'bg-blue-50 text-blue-700',
  '4%':   'bg-amber-50 text-amber-700',
  '5%':   'bg-emerald-50 text-emerald-700',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString('ru-RU') + ' ₽' }
function fmtM(n: number) { return (n / 1_000_000).toFixed(1) + 'M' }
function monthLabel(key: string) {
  const [y, m] = key.split('-')
  const names = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
  return `${names[parseInt(m)]} ${y}`
}
const ddmm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`
const nextMonthKey = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
}
const prevMonthKey = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
}

// Лейбл tier'а из активной конфигурации (для бейджей "ставка X%").
// Если ratePercent не из стандартного набора (TIER_COLORS), вернётся "{N}%".
function tierLabelFor(revenue: number, tiers: CommissionTier[]): string {
  const idx = currentTierIndex(revenue, tiers)
  const t   = tiers[idx]
  if (!t) return '2%'
  // целые → "2%", дробные → "2.5%"
  const r = t.ratePercent
  return Number.isInteger(r) ? `${r}%` : `${r}%`
}

// Streak bonus: ищем наибольший порог, на котором последние 3 завершённых месяца ≥ minRevenue.
function calcStreakBonus(
  completedMonthsDesc: { revenue: number }[],
  bonuses:             StreakBonus[],
): { bonus: number; minRevenue: number; months: number } {
  // completedMonthsDesc — без текущего месяца, отсортирован по убыванию (свежие первые)
  if (completedMonthsDesc.length < 3) return { bonus: 0, minRevenue: 0, months: completedMonthsDesc.length }
  const last3 = completedMonthsDesc.slice(0, 3)
  // от высшего тира вниз — берём максимальный, который подтверждается тремя месяцами
  const sorted = [...bonuses].sort((a, b) => a.minRevenue - b.minRevenue)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const t = sorted[i]
    if (last3.every(m => m.revenue >= t.minRevenue)) {
      return { bonus: t.bonus, minRevenue: t.minRevenue, months: 3 }
    }
  }
  return { bonus: 0, minRevenue: 0, months: 0 }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MyEarningsPage() {
  const [data, setData]             = useState<EarningsResponse | null>(null)
  const [dataError, setDataError]   = useState<string | null>(null)
  const [role, setRole]             = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [forbidden, setForbidden]   = useState(false)
  const [showRules, setShowRules]     = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  // Глобальная B2C-конфигурация. null = ещё не загружено или ошибка → fallback.
  const [earningsSettings, setEarningsSettings] = useState<EarningsSettings | null>(null)
  const [settingsFallbackReason, setSettingsFallbackReason] = useState<string | null>(null)

  // Owner edit form — отдельный буфер, чтобы изменения применялись только при Save.
  const [settingsDraft, setSettingsDraft] = useState<EarningsSettings>(EARNINGS_SETTINGS_FALLBACK)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsSaved, setSettingsSaved]   = useState(false)
  const [settingsError, setSettingsError]   = useState<string | null>(null)

  // ── Manager income calculator ─────────────────────────────────────────────
  // Прогноз дохода менеджера: вводит планируемую выручку и (опционально) бонус,
  // получает оклад + комиссию + бонус + итог.
  const [plannedRevenue, setPlannedRevenue] = useState(3_000_000)
  const [plannedBonus, setPlannedBonus]     = useState(0)

  // ── Owner calculator ──────────────────────────────────────────────────────
  // Управленческая оценка экономики для владельца. Независимые поля, не
  // привязаны к менеджерскому калькулятору — owner может моделировать иные
  // сценарии. Кнопка "Подставить из калькулятора менеджера" копирует значения.
  const [ownerRevenue, setOwnerRevenue]               = useState(3_000_000)
  const [ownerGrossMarginPct, setOwnerGrossMarginPct] = useState(40)
  const [ownerSalary, setOwnerSalary]                 = useState(DEFAULT_MANAGER_SALARY_RUB)
  const [ownerBonus, setOwnerBonus]                   = useState(0)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: userData } = await supabase
        .from('users').select('role').eq('id', user.id).single()
      const userRole = (userData?.role ?? '').toString().toLowerCase()
      setRole(userRole)
      // Доступ: менеджеры (своя страница заработка) + owner-tier (admin/ceo/owner)
      // для управленческих калькуляторов и заготовки рейтинга.
      if (!['admin', 'ceo', 'owner', 'manager'].includes(userRole)) {
        setForbidden(true); setLoading(false); return
      }

      // Владелец смотрит любого продавца по ?m=<amo-id>, как «Утро»; менеджеру API
      // отдаёт только его самого, что бы ни стояло в адресе.
      const m = new URLSearchParams(window.location.search).get('m')
      const [earnings, { data: settingsRow, error: settingsError }] = await Promise.all([
        fetch(`/api/my-earnings${m ? `?m=${encodeURIComponent(m)}` : ''}`)
          .then(async r => (r.ok ? (await r.json()) as EarningsResponse : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `ошибка ${r.status}`))))
          .catch((e: Error) => { setDataError(e.message); return null }),
        supabase
          .from('earnings_settings')
          .select('scope, active, base_salary_rub, commission_tiers, streak_bonuses, effective_from, rules_note')
          .eq('scope', 'b2c_manager')
          .maybeSingle(),
      ])
      setData(earnings)

      if (settingsError) {
        setSettingsFallbackReason(`Ошибка загрузки настроек: ${settingsError.message}. Используются базовые правила.`)
      } else if (settingsRow) {
        const row = settingsRow as Record<string, unknown>
        const loaded: EarningsSettings = {
          baseSalaryRub:   Number(row.base_salary_rub ?? EARNINGS_SETTINGS_FALLBACK.baseSalaryRub),
          commissionTiers: Array.isArray(row.commission_tiers) ? (row.commission_tiers as CommissionTier[]) : EARNINGS_SETTINGS_FALLBACK.commissionTiers,
          streakBonuses:   Array.isArray(row.streak_bonuses)   ? (row.streak_bonuses as StreakBonus[])     : EARNINGS_SETTINGS_FALLBACK.streakBonuses,
          effectiveFrom:   typeof row.effective_from === 'string' ? row.effective_from : EARNINGS_SETTINGS_FALLBACK.effectiveFrom,
          rulesNote:       typeof row.rules_note === 'string' ? row.rules_note : EARNINGS_SETTINGS_FALLBACK.rulesNote,
        }
        setEarningsSettings(loaded)
        setSettingsDraft(loaded)
      } else {
        setSettingsFallbackReason('Строки настроек для scope=b2c_manager не найдено. Применяются базовые правила. Сохраните настройки, чтобы создать строку в БД.')
      }
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  const cash     = data?.cash ?? null
  const nowKey   = cash?.month ?? new Date().toISOString().slice(0, 7)

  // Активная конфигурация: то, что загружено из БД, иначе fallback.
  // Все нижеследующие расчёты идут через effSettings — один источник правды.
  const effSettings = earningsSettings ?? EARNINGS_SETTINGS_FALLBACK
  const effSalary   = effSettings.baseSalaryRub
  const effTiers    = effSettings.commissionTiers
  const effBonuses  = effSettings.streakBonuses

  // ── Месяцы из книги ────────────────────────────────────────────────────────
  // Кассовый метод: выручка месяца = предоплаты + остатки из «Аналитики дохода».
  // Закрытые месяцы — итогом месяца книги, текущий — по внесённым дням.
  const byMonth = useMemo(() => {
    const m: Record<string, { revenue: number; dealCount: number }> = {}
    for (const x of cash?.months ?? []) {
      if (cashOf(x) === 0 && x.payments === 0 && x.month !== nowKey) continue
      m[x.month] = { revenue: cashOf(x), dealCount: x.payments }
    }
    return m
  }, [cash, nowKey])

  const sortedMonthKeys = useMemo(() => Object.keys(byMonth).sort((a, b) => b.localeCompare(a)), [byMonth])
  // Серия — только закрытые месяцы с даты вступления правил в силу.
  const completedMonthsDesc = useMemo(
    () => sortedMonthKeys.filter(k => k < nowKey && k >= effSettings.effectiveFrom.slice(0, 7)).map(k => byMonth[k]),
    [sortedMonthKeys, byMonth, nowKey, effSettings.effectiveFrom],
  )

  const curRevenue = byMonth[nowKey]?.revenue ?? 0
  const curDeals   = byMonth[nowKey]?.dealCount ?? 0
  const curCommission = useMemo(
    () => calculateProgressiveCommission(curRevenue, effTiers),
    [curRevenue, effTiers],
  )
  const distance = distanceToNextTier(curRevenue, effTiers)
  const streak   = useMemo(() => calcStreakBonus(completedMonthsDesc, effBonuses), [completedMonthsDesc, effBonuses])

  const totalIncome = effSalary + curCommission.totalCommission + streak.bonus

  // ── Поступления по дням, выплаты, план ─────────────────────────────────────
  const days = useMemo(() => dayCommissions(cash?.days ?? [], effTiers).reverse(), [cash, effTiers])
  const firstHalf = (cash?.days ?? []).filter(d => Number(d.date.slice(8, 10)) <= 15).reduce((s, d) => s + cashOf(d), 0)
  const split = payoutSplit(firstHalf, curRevenue, effTiers)
  const prevKey = prevMonthKey(nowKey)
  const prevTotal = byMonth[prevKey]?.revenue ?? 0
  const prevFirstHalf = (cash?.prevDays ?? []).filter(d => Number(d.date.slice(8, 10)) <= 15).reduce((s, d) => s + cashOf(d), 0)
  const prevSplit = payoutSplit(prevFirstHalf, prevTotal, effTiers)
  const plan = cash ? planProgress({ plan: cash.plan, cash: curRevenue, month: nowKey, today: cash.today, bookLastDay: cash.bookLastDay, workDays: cash.workDays }) : null
  const bookNote = plan?.dataThrough ? `книга внесена по ${ddmm(plan.dataThrough)}` : `за ${monthLabel(nowKey)} в книге пока нет записей`

  // ── Manager income calculator: производные ─────────────────────────────────
  const plannedCommission = useMemo(
    () => calculateProgressiveCommission(plannedRevenue, effTiers),
    [plannedRevenue, effTiers],
  )
  const plannedDistance   = distanceToNextTier(plannedRevenue, effTiers)
  const plannedTotalIncome = effSalary + plannedCommission.totalCommission + plannedBonus

  // ── Owner calculator: производные ──────────────────────────────────────────
  const ownerCommission = useMemo(
    () => calculateProgressiveCommission(ownerRevenue, effTiers),
    [ownerRevenue, effTiers],
  )
  const ownerManagerIncome    = ownerSalary + ownerCommission.totalCommission + ownerBonus
  const ownerGrossProfit      = Math.round(ownerRevenue * ownerGrossMarginPct / 100)
  const ownerCompanyRemainder = ownerGrossProfit - ownerManagerIncome
  const ownerShareOfRevenue   = ownerRevenue > 0 ? (ownerManagerIncome / ownerRevenue) * 100 : 0
  const ownerShareOfGross     = ownerGrossProfit > 0 ? (ownerManagerIncome / ownerGrossProfit) * 100 : 0

  function syncOwnerFromManagerCalc() {
    setOwnerRevenue(plannedRevenue)
    setOwnerBonus(plannedBonus)
    setOwnerSalary(effSalary)
  }

  if (loading)   return <div className="p-8 text-center text-[#9a9a95] text-xs">Загрузка...</div>
  if (forbidden) return <div className="p-8 text-center text-[#9a9a95] text-xs">Доступ только для менеджеров и владельцев</div>

  const curTierLabel  = tierLabelFor(curRevenue, effTiers)
  const nextTierLabel = distance ? tierLabelFor(distance.nextFrom, effTiers) : null
  // Owner tier — admin / ceo / 'owner' alias. Менеджер не видит owner-блоки.
  const isOwner = role === 'admin' || role === 'ceo' || role === 'owner'
  const plannedTierLabel = tierLabelFor(plannedRevenue, effTiers)
  const ownerTierLabel   = tierLabelFor(ownerRevenue, effTiers)

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6 space-y-4">

        {/* Шапка */}
        <div>
          <h1 className="text-sm font-semibold text-[#111110]">
            {isOwner && cash ? `Деньги — ${cash.name}` : 'Мои деньги'}
          </h1>
          <p className="text-[10px] text-[#9a9a95] mt-0.5">
            Оклад + прогрессивная комиссия + бонус за серию · поступления из «Аналитики дохода»
          </p>
          {isOwner && data?.team && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {data.team.people.map(p => (
                <a key={p.amoUserId} href={`/my-earnings?m=${p.amoUserId}`}
                  className={`text-[11px] px-2 py-0.5 rounded-full border ${cash?.amoUserId === p.amoUserId ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#4b4b47] hover:border-[#9a9a95]'}`}>
                  {p.name}
                </a>
              ))}
            </div>
          )}
        </div>

        {dataError && (
          <p className="text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">Поступления не загрузились: {dataError}</p>
        )}
        {cash && cash.errors.length > 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">Часть данных не загрузилась: {cash.errors.join('; ')}</p>
        )}
        {!cash && !dataError && (
          <p className="text-[11px] text-[#6b6b66] bg-[#fafaf9] border border-[#e4e4e0] rounded-lg px-3 py-2">
            {isOwner ? 'Выберите менеджера выше — здесь его поступления, комиссия и выплаты.' : 'Учётка не связана с пользователем AmoCRM — поступления не к кому привязать. Напишите руководителю.'}
          </p>
        )}

        {/* ── Регламент (как работает заработок) ─────────────────────────────── */}
        <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[11px] font-semibold text-[#111110] mb-1.5">Как работает заработок</p>
          <p className="text-[11px] text-[#6b6b66] leading-snug">
            Действует с <span className="font-semibold">{effSettings.effectiveFrom}</span>.
            Доход = <span className="font-semibold">оклад {fmt(effSalary)}</span>
            {' + '}прогрессивная комиссия с оплаченной B2C-выручки{' + '}бонус за серию.
          </p>
          <p className="text-[10px] text-[#9a9a95] leading-snug mt-1">
            Кассовый метод: в зачёт идут только фактически поступившие деньги по B2C-заказам. Выплаты 27 числа (1-15) и 15 числа (16-конец прошлого месяца).
          </p>
          {settingsFallbackReason && isOwner && (
            <p className="text-[10px] text-amber-700 leading-snug mt-2">
              ⚠ {settingsFallbackReason}
            </p>
          )}
          {settingsFallbackReason && !isOwner && (
            <p className="text-[10px] text-[#9a9a95] leading-snug mt-2">
              Используются базовые правила (настройки не загрузились — обратитесь к админу).
            </p>
          )}
          <button
            onClick={() => setShowRules(v => !v)}
            className="text-[11px] text-blue-600 hover:underline mt-2"
          >
            {showRules ? 'Свернуть' : 'Подробнее →'}
          </button>
          {showRules && (
            <div className="mt-3 pt-3 border-t border-[#e4e4e0] space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Регламент</p>
                <p className="text-[11px] text-[#6b6b66] leading-snug whitespace-pre-wrap">{effSettings.rulesNote}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Ступенчатая комиссия</p>
                <ul className="text-[11px] text-[#6b6b66] space-y-0.5">
                  {effTiers.map((t, i) => {
                    const fromM = (t.from / 1_000_000).toFixed(t.from % 1_000_000 === 0 ? 0 : 1)
                    const toLbl = t.to == null ? '∞' : `${(t.to / 1_000_000).toFixed(t.to % 1_000_000 === 0 ? 0 : 1)} млн`
                    const prefix = i === 0 ? `до ${toLbl}` : `с ${fromM} до ${toLbl}`
                    const finalPrefix = t.to == null ? `свыше ${fromM} млн` : prefix
                    return (
                      <li key={`${t.from}-${t.ratePercent}`}>
                        · {finalPrefix} — <span className="font-mono font-semibold">{t.ratePercent}%</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-[11px] text-[#6b6b66] leading-snug mt-2">
                  Процент применяется <span className="font-semibold">только к сумме внутри диапазона</span>, а не ко всей выручке.
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Бонус за серию</p>
                <ul className="text-[11px] text-[#6b6b66] space-y-0.5">
                  {effBonuses.map(b => (
                    <li key={b.minRevenue}>
                      · 3 мес ≥ <span className="font-mono">{(b.minRevenue / 1_000_000).toFixed(0)}M</span> → <span className="font-mono font-semibold">+{fmt(b.bonus)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* ── Настройки системы мотивации (owner/admin) ──────────────────────── */}
        {isOwner && (
          <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
            <button onClick={() => setShowSettings(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-50/40 transition-colors">
              <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-widest">Настройки системы мотивации</p>
              <span className="text-[10px] text-amber-700">для всех менеджеров</span>
            </button>
            {showSettings && (
              <div className="px-4 pb-4 border-t border-amber-200 space-y-3">
                <p className="text-[11px] text-[#6b6b66] mt-3 leading-snug">
                  Меняется один раз, применяется ко всем менеджерам. После Сохранить → menager увидит новые правила после reload.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-[#9a9a95]">Оклад менеджера, ₽</label>
                    <input type="number" min={0} step={1000} value={settingsDraft.baseSalaryRub}
                      onChange={e => setSettingsDraft(d => ({ ...d, baseSalaryRub: Number(e.target.value) || 0 }))}
                      className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#9a9a95]">Дата начала действия</label>
                    <input type="date" value={settingsDraft.effectiveFrom}
                      onChange={e => setSettingsDraft(d => ({ ...d, effectiveFrom: e.target.value }))}
                      className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs" />
                  </div>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider mb-1">Комиссионные ступени</p>
                  <div className="space-y-1">
                    {settingsDraft.commissionTiers.map((t, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr_80px_auto] gap-2 items-center">
                        <input type="number" min={0} step={100_000} value={t.from}
                          disabled={idx === 0}
                          onChange={e => {
                            const v = Number(e.target.value) || 0
                            setSettingsDraft(d => {
                              const next = [...d.commissionTiers]
                              next[idx] = { ...next[idx], from: v }
                              if (idx > 0) next[idx - 1] = { ...next[idx - 1], to: v }
                              return { ...d, commissionTiers: next }
                            })
                          }}
                          className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono disabled:bg-[#fafaf9]" />
                        <input type="number" min={0} step={100_000}
                          value={t.to ?? ''}
                          placeholder={t.to == null ? '∞' : ''}
                          disabled={idx === settingsDraft.commissionTiers.length - 1}
                          onChange={e => {
                            const raw = e.target.value
                            const v = raw === '' ? null : (Number(raw) || 0)
                            setSettingsDraft(d => {
                              const next = [...d.commissionTiers]
                              next[idx] = { ...next[idx], to: v }
                              if (idx + 1 < next.length && v != null) {
                                next[idx + 1] = { ...next[idx + 1], from: v }
                              }
                              return { ...d, commissionTiers: next }
                            })
                          }}
                          className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono disabled:bg-[#fafaf9]" />
                        <input type="number" min={0} max={100} step={0.1} value={t.ratePercent}
                          onChange={e => {
                            const v = Number(e.target.value) || 0
                            setSettingsDraft(d => {
                              const next = [...d.commissionTiers]
                              next[idx] = { ...next[idx], ratePercent: v }
                              return { ...d, commissionTiers: next }
                            })
                          }}
                          className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono" />
                        <span className="text-[10px] text-[#9a9a95] w-4">%</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-[#9a9a95] mt-1">Первая from = 0; последняя to = ∞ (оставьте пустым). Соседние границы автоматически синхронизируются.</p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider mb-1">Бонусы серии (3 мес ≥ порог)</p>
                  <div className="space-y-1">
                    {settingsDraft.streakBonuses.map((b, idx) => (
                      <div key={idx} className="grid grid-cols-[1fr_1fr] gap-2 items-center">
                        <input type="number" min={0} step={100_000} value={b.minRevenue}
                          onChange={e => {
                            const v = Number(e.target.value) || 0
                            setSettingsDraft(d => {
                              const next = [...d.streakBonuses]
                              next[idx] = { ...next[idx], minRevenue: v }
                              return { ...d, streakBonuses: next }
                            })
                          }}
                          className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono" />
                        <input type="number" min={0} step={1000} value={b.bonus}
                          onChange={e => {
                            const v = Number(e.target.value) || 0
                            setSettingsDraft(d => {
                              const next = [...d.streakBonuses]
                              next[idx] = { ...next[idx], bonus: v }
                              return { ...d, streakBonuses: next }
                            })
                          }}
                          className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-[#9a9a95]">Текст регламента / пояснение</label>
                  <textarea rows={3} value={settingsDraft.rulesNote}
                    onChange={e => setSettingsDraft(d => ({ ...d, rulesNote: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs" />
                </div>

                {settingsError && (
                  <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-[11px] text-red-700">
                    {settingsError}
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      setSavingSettings(true); setSettingsSaved(false); setSettingsError(null)
                      // Простая валидация: сумма ставок < 100, все from >= 0.
                      const tiers = settingsDraft.commissionTiers
                      for (let i = 0; i < tiers.length; i++) {
                        if (tiers[i].ratePercent < 0 || tiers[i].ratePercent >= 100) {
                          setSettingsError(`Ставка ${i + 1} вне диапазона [0, 100).`); setSavingSettings(false); return
                        }
                        if (i > 0 && tiers[i].from < tiers[i - 1].from) {
                          setSettingsError(`Ступень ${i + 1}: from меньше предыдущего.`); setSavingSettings(false); return
                        }
                      }
                      const supabase = createClient()
                      const payload = {
                        scope:            'b2c_manager',
                        active:           true,
                        base_salary_rub:  settingsDraft.baseSalaryRub,
                        commission_tiers: settingsDraft.commissionTiers,
                        streak_bonuses:   settingsDraft.streakBonuses,
                        effective_from:   settingsDraft.effectiveFrom,
                        rules_note:       settingsDraft.rulesNote,
                        updated_at:       new Date().toISOString(),
                      }
                      const { data, error } = await supabase
                        .from('earnings_settings')
                        .upsert(payload, { onConflict: 'scope' })
                        .select('scope, active, base_salary_rub, commission_tiers, streak_bonuses, effective_from, rules_note')
                        .single()
                      if (error) {
                        setSettingsError(error.message); setSavingSettings(false); return
                      }
                      if (!data) {
                        setSettingsError('Supabase не вернул строку (возможно, RLS отфильтровал запрос).')
                        setSavingSettings(false); return
                      }
                      const row = data as Record<string, unknown>
                      const loaded: EarningsSettings = {
                        baseSalaryRub:   Number(row.base_salary_rub ?? EARNINGS_SETTINGS_FALLBACK.baseSalaryRub),
                        commissionTiers: Array.isArray(row.commission_tiers) ? (row.commission_tiers as CommissionTier[]) : EARNINGS_SETTINGS_FALLBACK.commissionTiers,
                        streakBonuses:   Array.isArray(row.streak_bonuses)   ? (row.streak_bonuses as StreakBonus[])     : EARNINGS_SETTINGS_FALLBACK.streakBonuses,
                        effectiveFrom:   typeof row.effective_from === 'string' ? row.effective_from : EARNINGS_SETTINGS_FALLBACK.effectiveFrom,
                        rulesNote:       typeof row.rules_note === 'string' ? row.rules_note : EARNINGS_SETTINGS_FALLBACK.rulesNote,
                      }
                      setEarningsSettings(loaded)
                      setSettingsDraft(loaded)
                      setSettingsFallbackReason(null)
                      setSettingsSaved(true); setSavingSettings(false)
                      setTimeout(() => setSettingsSaved(false), 2500)
                    }}
                    disabled={savingSettings}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50">
                    {savingSettings ? 'Сохранение...' : 'Сохранить настройки для всех менеджеров'}
                  </button>
                  {settingsSaved && <span className="text-[11px] text-emerald-700 font-semibold">✓ Сохранено</span>}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Калькулятор дохода менеджера ──────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Калькулятор дохода</p>
          <p className="text-[11px] text-[#6b6b66] mb-3 leading-snug">
            Введите план по оплаченной B2C-выручке за месяц (фактические поступления денег) и увидите прогноз дохода.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#9a9a95]">Плановая оплаченная B2C-выручка за месяц, ₽</label>
              <input type="number" min={0} step={100_000} value={plannedRevenue}
                onChange={e => setPlannedRevenue(Number(e.target.value) || 0)}
                className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-[#9a9a95]">Бонус серии</label>
              <select value={plannedBonus}
                onChange={e => setPlannedBonus(Number(e.target.value))}
                className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs">
                <option value={0}>Нет</option>
                <option value={20_000}>+20 000 ₽ (3 мес ≥ 3M)</option>
                <option value={40_000}>+40 000 ₽ (3 мес ≥ 4M)</option>
                <option value={60_000}>+60 000 ₽ (3 мес ≥ 5M)</option>
              </select>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#f2f2f0] grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-[#9a9a95]">Комиссия</p>
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(plannedCommission.totalCommission)}</p>
              <p className="text-[10px] text-[#b8b8b4] mt-0.5">ступень {plannedTierLabel}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Оклад</p>
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(effSalary)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Бонус серии</p>
              <p className={`text-sm font-mono font-semibold ${plannedBonus > 0 ? 'text-amber-700' : 'text-[#c4c4be]'}`}>
                {plannedBonus > 0 ? `+${fmt(plannedBonus)}` : '0 ₽'}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-emerald-600">Итого доход</p>
              <p className="text-lg font-mono font-bold text-emerald-700">{fmt(plannedTotalIncome)}</p>
            </div>
          </div>
          {plannedDistance && (
            <p className="text-[10px] text-[#6b6b66] mt-2 leading-snug">
              До следующей ступени осталось <span className="font-mono font-semibold text-[#111110]">{fmt(plannedDistance.remaining)}</span>
              {' '}(следующая ставка <span className="font-mono font-semibold">{plannedDistance.ratePercent}%</span>).
            </p>
          )}
        </div>

        {/* ── Калькулятор собственника (только для owner/admin/ceo) ─────────── */}
        {isOwner && (
          <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Калькулятор собственника</p>
              <button onClick={syncOwnerFromManagerCalc}
                className="text-[10px] text-blue-600 hover:underline">
                ← Подставить из калькулятора менеджера
              </button>
            </div>
            <p className="text-[11px] text-[#6b6b66] mb-3 leading-snug">
              Проверка: высокий доход менеджера — не проблема, если он делает больше оборота. Сравниваем менеджерский кошт и валовую прибыль.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-[#9a9a95]">Оплаченная B2C-выручка менеджера за месяц, ₽</label>
                <input type="number" min={0} step={100_000} value={ownerRevenue}
                  onChange={e => setOwnerRevenue(Number(e.target.value) || 0)}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
                <p className="text-[10px] text-[#9a9a95] mt-1 leading-snug">Расчёт строится по поступившим деньгам, а не по сумме оформленных заказов.</p>
              </div>
              <div>
                <label className="text-[10px] text-[#9a9a95]">Валовая маржа компании, %</label>
                <input type="number" min={0} max={99} step={1} value={ownerGrossMarginPct}
                  onChange={e => setOwnerGrossMarginPct(Number(e.target.value) || 0)}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-[#9a9a95]">Оклад менеджера, ₽</label>
                <input type="number" min={0} step={1_000} value={ownerSalary}
                  onChange={e => setOwnerSalary(Number(e.target.value) || 0)}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-[#9a9a95]">Бонус серии</label>
                <select value={ownerBonus}
                  onChange={e => setOwnerBonus(Number(e.target.value))}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs">
                  <option value={0}>Нет</option>
                  <option value={20_000}>+20 000 ₽</option>
                  <option value={40_000}>+40 000 ₽</option>
                  <option value={60_000}>+60 000 ₽</option>
                </select>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#f2f2f0] space-y-1">
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#6b6b66]">Выручка</span>
                <span className="text-[12px] font-mono font-semibold text-[#111110]">{fmt(ownerRevenue)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#6b6b66]">Оценочная валовая прибыль ({ownerGrossMarginPct}%)</span>
                <span className="text-[12px] font-mono font-semibold text-[#111110]">{fmt(ownerGrossProfit)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-1.5 border-t border-dotted border-[#eaeae6]">
                <span className="text-[11px] text-[#6b6b66]">Комиссия менеджера (ступень {ownerTierLabel})</span>
                <span className="text-[12px] font-mono text-[#4b4b47]">{fmt(ownerCommission.totalCommission)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#6b6b66]">Оклад менеджера</span>
                <span className="text-[12px] font-mono text-[#4b4b47]">{fmt(ownerSalary)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[11px] text-[#6b6b66]">Бонус серии</span>
                <span className={`text-[12px] font-mono ${ownerBonus > 0 ? 'text-amber-700' : 'text-[#c4c4be]'}`}>
                  {ownerBonus > 0 ? `+${fmt(ownerBonus)}` : '0 ₽'}
                </span>
              </div>
              <div className="flex justify-between items-baseline pt-1.5 border-t border-[#f0f0ee]">
                <span className="text-[11px] font-semibold text-[#4b4b47]">Итого менеджеру</span>
                <span className="text-[13px] font-mono font-bold text-[#111110]">{fmt(ownerManagerIncome)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-1.5 border-t border-[#f0f0ee]">
                <span className="text-[11px] text-emerald-700 font-semibold">Остаток до прочих расходов</span>
                <span className={`text-[14px] font-mono font-bold ${ownerCompanyRemainder >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(ownerCompanyRemainder)}
                </span>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-[#f2f2f0] grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-[#9a9a95]">Доля менеджера от выручки</p>
                <p className="text-sm font-mono font-semibold text-[#4b4b47]">{ownerShareOfRevenue.toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-[10px] text-[#9a9a95]">Доля менеджера от валовой прибыли</p>
                <p className="text-sm font-mono font-semibold text-[#4b4b47]">{ownerShareOfGross.toFixed(1)}%</p>
              </div>
            </div>

            <p className="text-[10px] text-[#b8b8b4] mt-3 leading-snug">
              Это управленческая оценка. Фактическая прибыль зависит от себестоимости, рекламы, монтажей, переделок и прочих расходов.
            </p>
          </div>
        )}

        {/* ── Рейтинг менеджеров (только владельцу) ─────────────────────────── */}
        {isOwner && data?.team && (
          <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Рейтинг менеджеров · {monthLabel(data.team.month)}</p>
            <p className="text-[11px] text-[#6b6b66] leading-snug mb-3">
              Поступления текущего месяца из «Аналитики дохода»: предоплаты + остатки
              {data.team.bookLastDay ? `, книга внесена по ${ddmm(data.team.bookLastDay)}` : ''}. Комиссия — по прогрессивной шкале от суммы поступлений.
            </p>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-[#fafaf9] border-y border-[#e4e4e0]">
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Менеджер</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Поступило</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">План · выполнено</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Оплат</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Комиссия</span>
            </div>
            {[...data.team.people].sort((a, b) => b.cash - a.cash).map(m => (
              <a key={m.amoUserId} href={`/my-earnings?m=${m.amoUserId}`}
                className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-[#f5f5f3] hover:bg-[#fafaf9]">
                <span className="text-[11px] text-[#4b4b47]">{m.name} ›</span>
                <span className="text-[11px] font-mono text-[#4b4b47] text-right whitespace-nowrap">{fmt(m.cash)}</span>
                <span className="text-[11px] font-mono text-[#9a9a95] text-right whitespace-nowrap">{m.plan ? `${fmt(m.plan)} · ${Math.floor((m.cash / m.plan) * 100)} %` : 'нет плана'}</span>
                <span className="text-[11px] font-mono text-[#9a9a95] text-right whitespace-nowrap">{m.payments}</span>
                <span className="text-[11px] font-mono text-emerald-700 text-right whitespace-nowrap">{fmt(calculateProgressiveCommission(m.cash, effTiers).totalCommission)}</span>
              </a>
            ))}
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 bg-[#fafaf9] font-semibold">
              <span className="text-[11px] text-[#111110]">Итого</span>
              <span className="text-[11px] font-mono text-[#111110] text-right whitespace-nowrap">{fmt(data.team.people.reduce((s, m) => s + m.cash, 0))}</span>
              <span></span>
              <span className="text-[11px] font-mono text-[#9a9a95] text-right whitespace-nowrap">{data.team.people.reduce((s, m) => s + m.payments, 0)}</span>
              <span></span>
            </div>
          </div>
        )}

        {/* ── План и выплаты ─────────────────────────────────────────────────── */}
        {cash && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">План · {monthLabel(nowKey)}</p>
              {plan?.plan != null ? (
                <>
                  <p className="text-base font-mono font-semibold text-[#111110]">выполнено {Math.floor(plan.pct ?? 0)} %</p>
                  <div className="h-1.5 rounded-full bg-[#efefeb] overflow-hidden my-1.5">
                    <div className="h-full bg-[#111110]" style={{ width: `${Math.min(100, plan.pct ?? 0)}%` }} />
                  </div>
                  <p className="text-[11px] text-[#4b4b47] leading-snug">{fmt(curRevenue)} из {fmt(plan.plan)}</p>
                  <p className="text-[11px] text-[#6b6b66] leading-snug">
                    {plan.forecast != null ? `По темпу к концу месяца: ${fmt(plan.forecast)}.` : 'Прогноза по темпу пока нет.'}
                    {plan.needPerDay != null && (plan.needPerDay > 0 ? ` Нужно ${fmt(plan.needPerDay)} в рабочий день, осталось ${plan.daysLeft}.` : ' План закрыт.')}
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-[#6b6b66] leading-snug">План на месяц не поставлен — его ставит руководитель.</p>
              )}
              <p className="text-[10px] text-[#9a9a95] mt-1.5 leading-snug">План — в поступлениях: предоплаты + остатки · {bookNote}</p>
            </div>
            <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Выплаты комиссии</p>
              {[
                { date: `15.${nowKey.slice(5, 7)}`, what: `за 16–${monthEnd(prevKey).slice(8, 10)} ${monthLabel(prevKey).toLowerCase()}`, sum: prevSplit.second },
                { date: `27.${nowKey.slice(5, 7)}`, what: `за 1–15 ${monthLabel(nowKey).toLowerCase()}`, sum: split.first },
                { date: `15.${nextMonthKey(nowKey).slice(5, 7)}`, what: `за 16–${monthEnd(nowKey).slice(8, 10)} ${monthLabel(nowKey).toLowerCase()}`, sum: split.second },
              ].map(x => (
                <div key={x.date + x.what} className="flex items-baseline justify-between gap-3 py-1 border-b border-[#f5f5f3] last:border-0">
                  <span className="text-[11px] text-[#4b4b47]"><span className="font-mono font-semibold">{x.date}</span> · {x.what}</span>
                  <span className="text-[12px] font-mono font-semibold text-emerald-700 whitespace-nowrap">{fmt(x.sum)}</span>
                </div>
              ))}
              <p className="text-[10px] text-[#9a9a95] mt-1.5 leading-snug">
                Ступень — по накопленным поступлениям месяца, поэтому выплата 15-го добирает разницу. Текущий месяц — по тому, что уже внесено в книгу; оклад отдельно.
              </p>
            </div>
          </div>
        )}

        {/* ── Текущий месяц ──────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Текущий месяц · {monthLabel(nowKey)}</p>
              <p className="text-[11px] text-[#4b4b47] mt-0.5">Поступило (предоплаты + остатки): <span className="font-mono font-semibold">{fmt(curRevenue)}</span> · оплат {curDeals}{plan?.dataThrough ? ` · книга по ${ddmm(plan.dataThrough)}` : ''}</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TIER_COLORS[curTierLabel] ?? TIER_COLORS['2%']}`}>
              Ставка {curTierLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#f2f2f0]">
            <div>
              <p className="text-[10px] text-[#9a9a95]">Оклад</p>
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(effSalary)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Комиссия (прогрессивная)</p>
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(curCommission.totalCommission)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Бонус серии</p>
              <p className={`text-sm font-mono font-semibold ${streak.bonus > 0 ? 'text-amber-700' : 'text-[#c4c4be]'}`}>
                {streak.bonus > 0 ? `+${fmt(streak.bonus)}` : '0 ₽'}
              </p>
              {streak.bonus > 0 ? (
                <p className="text-[10px] text-amber-700 mt-0.5">3 мес ≥ {fmt(streak.minRevenue)}</p>
              ) : (
                <p className="text-[10px] text-[#b8b8b4] mt-0.5">по закрытым месяцам</p>
              )}
            </div>
            <div>
              <p className="text-[10px] text-emerald-600">Итого прогноз дохода</p>
              <p className="text-lg font-mono font-bold text-emerald-700">{fmt(totalIncome)}</p>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-[#f2f2f0]">
            {distance ? (
              <p className="text-[11px] text-[#6b6b66] leading-snug">
                До следующей ступени осталось <span className="font-mono font-semibold text-[#111110]">{fmt(distance.remaining)}</span>.
                {' '}Следующая ставка: <span className={`font-mono font-semibold ${TIER_COLORS[nextTierLabel ?? '2%']?.split(' ')[1] ?? ''}`}>{distance.ratePercent}%</span>
              </p>
            ) : (
              <p className="text-[11px] text-emerald-700 font-semibold">Максимальный тир достигнут — каждый рубль выручки приносит 5%.</p>
            )}
          </div>
        </div>

        {/* ── Прогресс по диапазонам ─────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Где вы сейчас на шкале</p>
          <div className="space-y-1.5">
            {effTiers.map((t, i) => {
              const tierResult = curCommission.tiers[i]
              const filled    = tierResult.amountInTier > 0
              const upperLabel = t.to == null ? '∞' : `${(t.to / 1_000_000).toFixed(0)}M`
              const isCurrent = curRevenue >= t.from && (t.to == null || curRevenue < t.to)
              return (
                <div key={t.from} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border ${
                  isCurrent ? 'border-emerald-200 bg-emerald-50/40' : filled ? 'border-[#e4e4e0] bg-[#fafaf9]' : 'border-[#f0f0ec] bg-white'
                }`}>
                  <span className={`text-[11px] font-mono w-16 flex-shrink-0 ${filled ? 'text-[#111110]' : 'text-[#c4c4be]'}`}>
                    {(t.from / 1_000_000).toFixed(t.from % 1_000_000 === 0 ? 0 : 1)}M–{upperLabel}
                  </span>
                  <span className={`text-[11px] font-mono font-semibold w-12 flex-shrink-0 ${filled ? 'text-[#111110]' : 'text-[#c4c4be]'}`}>
                    {t.ratePercent}%
                  </span>
                  <span className={`flex-1 text-[11px] font-mono text-right ${filled ? 'text-[#4b4b47]' : 'text-[#c4c4be]'}`}>
                    {filled ? fmt(tierResult.amountInTier) : '—'}
                  </span>
                  <span className={`text-[11px] font-mono font-semibold w-24 text-right ${filled ? 'text-emerald-700' : 'text-[#c4c4be]'}`}>
                    {filled ? `+${fmt(tierResult.commission)}` : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Бонусы за серию ─────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Бонус за серию</p>
          <p className="text-[11px] text-[#6b6b66] mb-2 leading-snug">
            3 закрытых календарных месяца подряд держать оплаченную B2C-выручку на уровне (текущий месяц в серию не входит):
          </p>
          <div className="grid grid-cols-3 gap-2">
            {effBonuses.map(b => {
              const active = streak.bonus === b.bonus
              return (
                <div key={b.minRevenue} className={`rounded-lg px-2.5 py-2 border ${
                  active ? 'border-amber-300 bg-amber-50' : 'border-[#e4e4e0] bg-[#fafaf9]'
                }`}>
                  <p className="text-[10px] text-[#9a9a95]">{(b.minRevenue / 1_000_000).toFixed(0)}M+ × 3 мес</p>
                  <p className={`text-sm font-mono font-bold ${active ? 'text-amber-700' : 'text-[#4b4b47]'}`}>+{fmt(b.bonus)}</p>
                </div>
              )
            })}
          </div>
          {completedMonthsDesc.length < 3 ? (
            <p className="text-[10px] text-[#9a9a95] mt-2 leading-snug">
              Серия считается по закрытым месяцам. Закрыто {completedMonthsDesc.length} из 3 нужных — история подключится по мере накопления поступлений.
            </p>
          ) : streak.bonus === 0 ? (
            <p className="text-[10px] text-[#9a9a95] mt-2 leading-snug">
              Последние 3 закрытых месяца на разных тирах — серия не сложилась.
            </p>
          ) : null}
        </div>

        {/* ── Поступления по дням ─────────────────────────────────────────────── */}
        {cash && (
          <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-[#fafaf9] border-b border-[#e4e4e0]">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Поступления по дням · {monthLabel(nowKey)}</p>
              <p className="text-[10px] text-[#9a9a95] mt-0.5">Из «Аналитики дохода»; комиссия дня — на сколько выросла комиссия месяца от его поступлений. Если сумма неверна — её правят в книге, здесь она обновится в 8:05.</p>
            </div>
            {days.length === 0 ? (
              <div className="p-6 text-center text-[#9a9a95] text-xs">За {monthLabel(nowKey)} поступлений в книге пока нет · {bookNote}</div>
            ) : (
              <>
                <div className="grid grid-cols-[70px_1fr_1fr_1fr_90px] gap-2 px-3 py-1.5 border-b border-[#e4e4e0]">
                  <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Дата</span>
                  <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Предоплаты</span>
                  <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Остатки</span>
                  <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Всего</span>
                  <span className="text-[10px] font-semibold text-emerald-600 uppercase text-right">Комиссия</span>
                </div>
                {days.map(d => (
                  <div key={d.date} className="grid grid-cols-[70px_1fr_1fr_1fr_90px] gap-2 items-center px-3 py-1.5 border-b border-[#f5f5f3] last:border-0">
                    <span className="text-[11px] text-[#6b6b66] font-mono">{ddmm(d.date)}</span>
                    <span className="text-[11px] font-mono text-[#4b4b47] text-right">{d.prepay ? fmt(d.prepay) : '—'}</span>
                    <span className="text-[11px] font-mono text-[#4b4b47] text-right">{d.remainder ? fmt(d.remainder) : '—'}</span>
                    <span className="text-[11px] font-mono font-semibold text-[#111110] text-right">{fmt(d.cash)}</span>
                    <span className="text-[11px] font-mono text-emerald-700 text-right">{fmt(d.commission)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── По месяцам ──────────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#fafaf9] border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">История по месяцам</p>
          </div>
          {sortedMonthKeys.length === 0 ? (
            <div className="p-6 text-center text-[#9a9a95] text-xs">Пока нет данных</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-1.5 border-b border-[#e4e4e0]">
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Месяц</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Выручка</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-center">Ставка</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Оплат</span>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase text-right">Комиссия</span>
              </div>
              {sortedMonthKeys.map(k => {
                const m = byMonth[k]
                const c = calculateProgressiveCommission(m.revenue, effTiers).totalCommission
                const tl = tierLabelFor(m.revenue, effTiers)
                const isCurrent = k === nowKey
                return (
                  <div key={k}
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-2 border-b border-[#f5f5f3] last:border-0 ${
                      isCurrent ? 'bg-emerald-50/40' : 'hover:bg-[#fafaf9]'
                    }`}>
                    <span className="text-xs text-[#111110]">{monthLabel(k)}{isCurrent && <span className="text-[10px] text-emerald-600 ml-1.5">сейчас</span>}</span>
                    <span className="text-xs font-mono text-[#4b4b47] text-right whitespace-nowrap">{fmtM(m.revenue)}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-center whitespace-nowrap ${TIER_COLORS[tl] ?? TIER_COLORS['2%']}`}>{tl}</span>
                    <span className="text-xs font-mono text-[#9a9a95] text-right whitespace-nowrap">{m.dealCount}</span>
                    <span className="text-xs font-mono font-bold text-emerald-700 text-right whitespace-nowrap">{fmt(c)}</span>
                  </div>
                )
              })}
            </>
          )}
        </div>

      </div>
    </div>
  )
}
