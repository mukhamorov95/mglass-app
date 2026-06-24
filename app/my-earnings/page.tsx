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
} from '@/lib/earnings/calculateProgressiveCommission'
import { TIERS } from '@/lib/commissionTiers'

// ── Types ────────────────────────────────────────────────────────────────────

type Calc = {
  id: number
  created_at: string
  product_type: string
  final_price: number
  margin: number
  status: string
}

// Локально хранимые ручные продажи менеджера. TODO: вынести в Supabase
// таблицу manager_sales после согласования схемы (status pending/counted/cancelled,
// admin-подтверждение, история смены статусов). Сейчас — localStorage MVP.
type LocalSaleStatus = 'pending' | 'counted' | 'cancelled'
type LocalSale = {
  id:          string
  date:        string   // YYYY-MM-DD
  order_ref:   string
  client:      string
  amount:      number
  comment:     string
  status:      LocalSaleStatus
  created_at:  string   // ISO
}

// ── Constants ────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  '2%':   'bg-gray-100 text-gray-600',
  '2.5%': 'bg-sky-50 text-sky-700',
  '3%':   'bg-blue-50 text-blue-700',
  '4%':   'bg-amber-50 text-amber-700',
  '5%':   'bg-emerald-50 text-emerald-700',
}

const STATUS_BADGES: Record<LocalSaleStatus | 'approved' | 'draft' | 'sent' | 'rejected', { label: string; color: string }> = {
  pending:   { label: 'Ожидает',   color: 'bg-amber-50 text-amber-700' },
  counted:   { label: 'Засчитано', color: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Отменено',  color: 'bg-red-50 text-red-500' },
  approved:  { label: 'Принят',    color: 'bg-emerald-50 text-emerald-700' },
  draft:     { label: 'Черновик',  color: 'bg-gray-100 text-gray-500' },
  sent:      { label: 'Отправлен', color: 'bg-blue-50 text-blue-600' },
  rejected:  { label: 'Отклонён',  color: 'bg-red-50 text-red-500' },
}

const TYPE_LABELS: Record<string, string> = { mirror: 'Зеркало', loft: 'Лофт', shower: 'Душевая' }

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number)  { return n.toLocaleString('ru-RU') + ' ₽' }
function fmtM(n: number) { return (n / 1_000_000).toFixed(1) + 'M' }
function todayYMD()      { const d = new Date(); return d.toISOString().slice(0, 10) }
function monthKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function ymdMonthKey(ymd: string) { return ymd.slice(0, 7) }
function monthLabel(key: string) {
  const [y, m] = key.split('-')
  const names = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
  return `${names[parseInt(m)]} ${y}`
}
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }

function loadLocalSales(userId: string | null): LocalSale[] {
  if (!userId || typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(`mglass.manager_sales.local.v1.${userId}`)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LocalSale[]) : []
  } catch { return [] }
}

function saveLocalSales(userId: string | null, sales: LocalSale[]) {
  if (!userId || typeof window === 'undefined') return
  window.localStorage.setItem(`mglass.manager_sales.local.v1.${userId}`, JSON.stringify(sales))
}

function tierLabelFor(revenue: number): string {
  const idx = currentTierIndex(revenue, DEFAULT_MANAGER_COMMISSION_TIERS)
  return TIERS[idx]?.label ?? '2%'
}

// Streak bonus: ищем наибольший порог, на котором последние 3 завершённых месяца ≥ minRevenue.
function calcStreakBonus(completedMonthsDesc: { revenue: number }[]): { bonus: number; minRevenue: number; months: number } {
  // completedMonthsDesc — без текущего месяца, отсортирован по убыванию (свежие первые)
  if (completedMonthsDesc.length < 3) return { bonus: 0, minRevenue: 0, months: completedMonthsDesc.length }
  const last3 = completedMonthsDesc.slice(0, 3)
  // от высшего тира вниз — берём максимальный, который подтверждается тремя месяцами
  for (let i = DEFAULT_STREAK_BONUSES.length - 1; i >= 0; i--) {
    const t = DEFAULT_STREAK_BONUSES[i]
    if (last3.every(m => m.revenue >= t.minRevenue)) {
      return { bonus: t.bonus, minRevenue: t.minRevenue, months: 3 }
    }
  }
  return { bonus: 0, minRevenue: 0, months: 0 }
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function MyEarningsPage() {
  const [calcs, setCalcs]           = useState<Calc[]>([])
  const [localSales, setLocalSales] = useState<LocalSale[]>([])
  const [userId, setUserId]         = useState<string | null>(null)
  const [role, setRole]             = useState<string | null>(null)
  const [loading, setLoading]       = useState(true)
  const [forbidden, setForbidden]   = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [showRules, setShowRules]     = useState(false)

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

  // Форма добавления продажи
  const [form, setForm] = useState<Omit<LocalSale, 'id' | 'created_at'>>({
    date:      todayYMD(),
    order_ref: '',
    client:    '',
    amount:    0,
    comment:   '',
    status:    'pending',
  })

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }
      setUserId(user.id)

      const { data: userData } = await supabase
        .from('users').select('role').eq('id', user.id).single()
      const userRole = (userData?.role ?? '').toString().toLowerCase()
      setRole(userRole)
      // Доступ: менеджеры (своя страница заработка) + owner-tier (admin/ceo/owner)
      // для управленческих калькуляторов и заготовки рейтинга.
      if (!['admin', 'ceo', 'owner', 'manager'].includes(userRole)) {
        setForbidden(true); setLoading(false); return
      }

      const { data } = await supabase
        .from('calculations')
        .select('id,created_at,product_type,final_price,margin,status')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
      setCalcs(data ?? [])
      setLocalSales(loadLocalSales(user.id))
      setLoading(false)
    }
    load().catch(() => setLoading(false))
  }, [])

  const nowKey   = monthKey(new Date().toISOString())
  const todayStr = todayYMD()

  // ── Combined month aggregates ──────────────────────────────────────────────
  // Источники выручки:
  //   1. Supabase calculations.status='approved' (зачитанная КП-цена).
  //   2. Local sales.status='counted' (ручные продажи менеджера).
  // pending/cancelled/draft/sent/rejected в комиссию не идут.
  const byMonth = useMemo(() => {
    const m: Record<string, { revenue: number; dealCount: number }> = {}
    for (const c of calcs) {
      if (c.status !== 'approved') continue
      const k = monthKey(c.created_at)
      if (!m[k]) m[k] = { revenue: 0, dealCount: 0 }
      m[k].revenue   += c.final_price
      m[k].dealCount += 1
    }
    for (const s of localSales) {
      if (s.status !== 'counted') continue
      const k = ymdMonthKey(s.date)
      if (!m[k]) m[k] = { revenue: 0, dealCount: 0 }
      m[k].revenue   += s.amount
      m[k].dealCount += 1
    }
    return m
  }, [calcs, localSales])

  const sortedMonthKeys = useMemo(() => Object.keys(byMonth).sort((a, b) => b.localeCompare(a)), [byMonth])
  const completedMonthsDesc = useMemo(
    () => sortedMonthKeys.filter(k => k < nowKey).map(k => byMonth[k]),
    [sortedMonthKeys, byMonth, nowKey],
  )

  const curRevenue = byMonth[nowKey]?.revenue ?? 0
  const curDeals   = byMonth[nowKey]?.dealCount ?? 0
  const curCommission = useMemo(
    () => calculateProgressiveCommission(curRevenue, DEFAULT_MANAGER_COMMISSION_TIERS),
    [curRevenue],
  )
  const distance = distanceToNextTier(curRevenue, DEFAULT_MANAGER_COMMISSION_TIERS)
  const streak   = useMemo(() => calcStreakBonus(completedMonthsDesc), [completedMonthsDesc])

  const totalIncome = DEFAULT_MANAGER_SALARY_RUB + curCommission.totalCommission + streak.bonus

  // ── Today aggregates ───────────────────────────────────────────────────────
  // Сегодняшняя добавленная активность: approved calculations + counted local sales.
  // "Комиссия за сегодня" = маржинальный вклад в месячную прогрессивную комиссию:
  // totalCommission(monthRevenue) − totalCommission(monthRevenue − todayRevenue).
  const todayApprovedCalcs = useMemo(
    () => calcs.filter(c => c.status === 'approved' && c.created_at.slice(0, 10) === todayStr),
    [calcs, todayStr],
  )
  const todayCountedSales = useMemo(
    () => localSales.filter(s => s.status === 'counted' && s.date === todayStr),
    [localSales, todayStr],
  )
  const todayRevenue = useMemo(() => (
    todayApprovedCalcs.reduce((s, c) => s + c.final_price, 0) +
    todayCountedSales.reduce((s, s2) => s + s2.amount, 0)
  ), [todayApprovedCalcs, todayCountedSales])
  const todayAddedCount = todayApprovedCalcs.length + todayCountedSales.length
  const todayCommission = useMemo(() => {
    const before = calculateProgressiveCommission(curRevenue - todayRevenue, DEFAULT_MANAGER_COMMISSION_TIERS).totalCommission
    return curCommission.totalCommission - before
  }, [curRevenue, todayRevenue, curCommission.totalCommission])

  // ── Combined sales table ───────────────────────────────────────────────────
  // Объединённый список: live calculations + local manual sales, отсортирован по дате DESC.
  type Row = {
    key:         string
    date:        string      // YYYY-MM-DD
    sourceLabel: string      // "Расчёт #ID" / "Ручная продажа"
    isLocal:     boolean
    localId?:    string
    client:      string
    amount:      number
    statusKey:   keyof typeof STATUS_BADGES
    counted:     boolean     // идёт ли в комиссию
  }
  const rows: Row[] = useMemo(() => {
    const calcRows: Row[] = calcs.map(c => ({
      key:         `c-${c.id}`,
      date:        c.created_at.slice(0, 10),
      sourceLabel: `${TYPE_LABELS[c.product_type] ?? c.product_type} #${c.id}`,
      isLocal:     false,
      client:      '—',
      amount:      c.final_price,
      statusKey:   (c.status in STATUS_BADGES ? c.status : 'draft') as keyof typeof STATUS_BADGES,
      counted:     c.status === 'approved',
    }))
    const localRows: Row[] = localSales.map(s => ({
      key:         `l-${s.id}`,
      date:        s.date,
      sourceLabel: s.order_ref ? `Ручная: ${s.order_ref}` : 'Ручная продажа',
      isLocal:     true,
      localId:     s.id,
      client:      s.client || '—',
      amount:      s.amount,
      statusKey:   s.status,
      counted:     s.status === 'counted',
    }))
    return [...calcRows, ...localRows].sort((a, b) => b.date.localeCompare(a.date))
  }, [calcs, localSales])

  // ── Manager income calculator: производные ─────────────────────────────────
  const plannedCommission = useMemo(
    () => calculateProgressiveCommission(plannedRevenue, DEFAULT_MANAGER_COMMISSION_TIERS),
    [plannedRevenue],
  )
  const plannedDistance   = distanceToNextTier(plannedRevenue, DEFAULT_MANAGER_COMMISSION_TIERS)
  const plannedTotalIncome = DEFAULT_MANAGER_SALARY_RUB + plannedCommission.totalCommission + plannedBonus

  // ── Owner calculator: производные ──────────────────────────────────────────
  const ownerCommission = useMemo(
    () => calculateProgressiveCommission(ownerRevenue, DEFAULT_MANAGER_COMMISSION_TIERS),
    [ownerRevenue],
  )
  const ownerManagerIncome    = ownerSalary + ownerCommission.totalCommission + ownerBonus
  const ownerGrossProfit      = Math.round(ownerRevenue * ownerGrossMarginPct / 100)
  const ownerCompanyRemainder = ownerGrossProfit - ownerManagerIncome
  const ownerShareOfRevenue   = ownerRevenue > 0 ? (ownerManagerIncome / ownerRevenue) * 100 : 0
  const ownerShareOfGross     = ownerGrossProfit > 0 ? (ownerManagerIncome / ownerGrossProfit) * 100 : 0

  function syncOwnerFromManagerCalc() {
    setOwnerRevenue(plannedRevenue)
    setOwnerBonus(plannedBonus)
    setOwnerSalary(DEFAULT_MANAGER_SALARY_RUB)
  }

  // ── Mutations: add / update / delete local sale ────────────────────────────
  function addLocalSale() {
    if (!userId) return
    if (!form.amount || form.amount <= 0) return
    const sale: LocalSale = {
      id:         uid(),
      date:       form.date || todayYMD(),
      order_ref:  form.order_ref.trim(),
      client:     form.client.trim(),
      amount:     Number(form.amount) || 0,
      comment:    form.comment.trim(),
      status:     form.status,
      created_at: new Date().toISOString(),
    }
    const next = [sale, ...localSales]
    setLocalSales(next)
    saveLocalSales(userId, next)
    setForm({ date: todayYMD(), order_ref: '', client: '', amount: 0, comment: '', status: 'pending' })
    setShowAddForm(false)
  }
  function setLocalStatus(id: string, status: LocalSaleStatus) {
    if (!userId) return
    const next = localSales.map(s => s.id === id ? { ...s, status } : s)
    setLocalSales(next)
    saveLocalSales(userId, next)
  }
  function deleteLocal(id: string) {
    if (!userId) return
    const next = localSales.filter(s => s.id !== id)
    setLocalSales(next)
    saveLocalSales(userId, next)
  }

  if (loading)   return <div className="p-8 text-center text-[#9a9a95] text-xs">Загрузка...</div>
  if (forbidden) return <div className="p-8 text-center text-[#9a9a95] text-xs">Доступ только для менеджеров и владельцев</div>

  const curTierLabel  = tierLabelFor(curRevenue)
  const nextTierLabel = distance ? TIERS[currentTierIndex(distance.nextFrom, DEFAULT_MANAGER_COMMISSION_TIERS)]?.label : null
  // Owner tier — admin / ceo / 'owner' alias. Менеджер не видит owner-блоки.
  const isOwner = role === 'admin' || role === 'ceo' || role === 'owner'
  const plannedTierLabel = tierLabelFor(plannedRevenue)
  const ownerTierLabel   = tierLabelFor(ownerRevenue)

  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-6 space-y-4">

        {/* Шапка */}
        <div>
          <h1 className="text-sm font-semibold text-[#111110]">Мои заработки</h1>
          <p className="text-[10px] text-[#9a9a95] mt-0.5">Оклад + прогрессивная комиссия + бонус за серию</p>
        </div>

        {/* ── Регламент (как работает заработок) ─────────────────────────────── */}
        <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[11px] font-semibold text-[#111110] mb-1.5">Как работает заработок</p>
          <p className="text-[11px] text-[#6b6b66] leading-snug">
            Новая система действует для <span className="font-semibold">B2C-заказов с 1 июля</span>.
            Доход = <span className="font-semibold">оклад {fmt(DEFAULT_MANAGER_SALARY_RUB)}</span>
            {' + '}прогрессивная комиссия{' + '}бонус за серию.
          </p>
          <button
            onClick={() => setShowRules(v => !v)}
            className="text-[11px] text-blue-600 hover:underline mt-2"
          >
            {showRules ? 'Свернуть' : 'Подробнее →'}
          </button>
          {showRules && (
            <div className="mt-3 pt-3 border-t border-[#e4e4e0] space-y-3">
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Что входит в зачёт</p>
                <p className="text-[11px] text-[#6b6b66] leading-snug">
                  Только подтверждённые B2C-продажи: оплаченные / принятые / засчитанные компанией.
                </p>
                <p className="text-[11px] text-[#6b6b66] leading-snug mt-1">
                  <span className="font-semibold text-[#4b4b47]">Не входят:</span> B2B-продажи, неоплаченные заказы, отменённые заказы, спорные сделки.
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Ступенчатая комиссия</p>
                <ul className="text-[11px] text-[#6b6b66] space-y-0.5">
                  <li>· до 2 млн — <span className="font-mono font-semibold">2%</span></li>
                  <li>· с 2 до 3 млн — <span className="font-mono font-semibold">2.5%</span></li>
                  <li>· с 3 до 4 млн — <span className="font-mono font-semibold">3%</span></li>
                  <li>· с 4 до 5 млн — <span className="font-mono font-semibold">4%</span></li>
                  <li>· свыше 5 млн — <span className="font-mono font-semibold">5%</span></li>
                </ul>
                <p className="text-[11px] text-[#6b6b66] leading-snug mt-2">
                  Процент применяется <span className="font-semibold">только к сумме внутри диапазона</span>, а не ко всей выручке.
                </p>
                <p className="text-[11px] text-[#6b6b66] leading-snug">
                  Пример: при 5 млн комиссия = <span className="font-mono font-semibold">135 000 ₽</span>, а не <span className="font-mono">250 000 ₽</span>.
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold text-[#111110] mb-1">Условия могут пересматриваться</p>
                <p className="text-[11px] text-[#6b6b66] leading-snug">
                  Правила пересматриваются по мере роста компании. Если поток заказов, база клиентов и партнёров вырастут, планки могут быть повышены — но условия всегда озвучиваются заранее и остаются прозрачными.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Калькулятор дохода менеджера ──────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Калькулятор дохода</p>
          <p className="text-[11px] text-[#6b6b66] mb-3 leading-snug">
            Введите план по B2C-выручке за месяц и увидите прогноз дохода.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-[#9a9a95]">Плановая B2C-выручка, ₽</label>
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
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(DEFAULT_MANAGER_SALARY_RUB)}</p>
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
                <label className="text-[10px] text-[#9a9a95]">B2C-выручка менеджера, ₽</label>
                <input type="number" min={0} step={100_000} value={ownerRevenue}
                  onChange={e => setOwnerRevenue(Number(e.target.value) || 0)}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1.5 text-xs text-right font-mono" />
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

        {/* ── Рейтинг менеджеров — placeholder (только для owner/admin/ceo) ──── */}
        {isOwner && (
          <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Рейтинг менеджеров</p>
              <div className="flex items-center gap-1">
                {(['Сегодня', 'Неделя', 'Месяц'] as const).map(p => (
                  <span key={p} className="text-[10px] text-[#c4c4be] px-2 py-0.5 border border-[#e4e4e0] rounded">{p}</span>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-[#6b6b66] leading-snug mb-3">
              Рейтинг будет строиться по подтверждённой B2C-выручке менеджеров. Сейчас подключён личный localStorage-режим, поэтому доступны только ваши данные. Следующий этап — таблица <span className="font-mono">manager_sales</span> в Supabase и общая админ-панель.
            </p>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-1.5 bg-[#fafaf9] border-y border-[#e4e4e0]">
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Менеджер</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">B2C-выручка</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Комиссия</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Заказов</span>
              <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Ср. чек</span>
            </div>
            <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-3 px-3 py-2 border-b border-[#f5f5f3]">
              <span className="text-[11px] text-[#4b4b47]">Вы (текущий месяц)</span>
              <span className="text-[11px] font-mono text-[#4b4b47] text-right whitespace-nowrap">{fmt(curRevenue)}</span>
              <span className="text-[11px] font-mono text-emerald-700 text-right whitespace-nowrap">{fmt(curCommission.totalCommission)}</span>
              <span className="text-[11px] font-mono text-[#9a9a95] text-right whitespace-nowrap">{curDeals}</span>
              <span className="text-[11px] font-mono text-[#9a9a95] text-right whitespace-nowrap">
                {curDeals > 0 ? fmt(Math.round(curRevenue / curDeals)) : '—'}
              </span>
            </div>
            <p className="text-[10px] text-[#c4c4be] mt-3 text-center leading-snug">
              Данные других менеджеров появятся после переноса учёта продаж в Supabase. Пока нет — не показываем, чтобы не вводить в заблуждение.
            </p>
          </div>
        )}

        {/* ── Сегодня ────────────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Сегодня</p>
            <p className="text-[10px] text-[#c4c4be]">{new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] text-[#9a9a95]">Продаж добавлено</p>
              <p className="text-base font-mono font-semibold text-[#111110]">{todayAddedCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Выручка засчитана</p>
              <p className="text-base font-mono font-semibold text-[#111110]">{fmt(todayRevenue)}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#9a9a95]">Комиссия за сегодня</p>
              <p className="text-base font-mono font-semibold text-emerald-700">{fmt(Math.max(0, todayCommission))}</p>
            </div>
          </div>
        </div>

        {/* ── Текущий месяц ──────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg px-4 py-3">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Текущий месяц · {monthLabel(nowKey)}</p>
              <p className="text-[11px] text-[#4b4b47] mt-0.5">Принятая B2C-выручка: <span className="font-mono font-semibold">{fmt(curRevenue)}</span> · {curDeals} сделок</p>
            </div>
            <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TIER_COLORS[curTierLabel] ?? TIER_COLORS['2%']}`}>
              Ставка {curTierLabel}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[#f2f2f0]">
            <div>
              <p className="text-[10px] text-[#9a9a95]">Оклад</p>
              <p className="text-sm font-mono font-semibold text-[#111110]">{fmt(DEFAULT_MANAGER_SALARY_RUB)}</p>
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
            {DEFAULT_MANAGER_COMMISSION_TIERS.map((t, i) => {
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
            3 месяца подряд держать выручку на уровне:
          </p>
          <div className="grid grid-cols-3 gap-2">
            {DEFAULT_STREAK_BONUSES.map(b => {
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
              Серия считается по закрытым месяцам. Закрыто {completedMonthsDesc.length} из 3 нужных — история подключится по мере накопления продаж.
            </p>
          ) : streak.bonus === 0 ? (
            <p className="text-[10px] text-[#9a9a95] mt-2 leading-snug">
              Последние 3 закрытых месяца на разных тирах — серия не сложилась.
            </p>
          ) : null}
        </div>

        {/* ── Добавить продажу ────────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden">
          <button onClick={() => setShowAddForm(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafaf9] transition-colors">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">+ Ручной ввод B2C-продажи</p>
            <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">локальный режим / тест</span>
          </button>
          {showAddForm && (
            <div className="px-4 pb-4 border-t border-[#f5f5f3] space-y-2">
              <p className="text-[11px] text-[#6b6b66] mt-3 leading-snug">
                Временный режим: менеджер может добавить продажу вручную. Позже B2C-продажи будут подтягиваться из заказов и оплат автоматически.
              </p>
              <p className="text-[10px] text-[#9a9a95] leading-snug">
                Каждый менеджер видит только свои ручные продажи в этом браузере (ключ привязан к user_id). После переноса в Supabase доступ будет ограничен по user_id на уровне RLS.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#9a9a95]">Дата</label>
                  <input type="date" value={form.date}
                    onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[#9a9a95]">Сумма, ₽</label>
                  <input type="number" min={0} value={form.amount || ''}
                    onChange={e => setForm(f => ({ ...f, amount: Number(e.target.value) }))}
                    className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs text-right font-mono" />
                </div>
                <div>
                  <label className="text-[10px] text-[#9a9a95]">Номер заказа / КП</label>
                  <input type="text" value={form.order_ref}
                    onChange={e => setForm(f => ({ ...f, order_ref: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-[#9a9a95]">Клиент</label>
                  <input type="text" value={form.client}
                    onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
                    className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-[#9a9a95]">Комментарий</label>
                <input type="text" value={form.comment}
                  onChange={e => setForm(f => ({ ...f, comment: e.target.value }))}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-[#9a9a95]">Статус</label>
                <select value={form.status}
                  onChange={e => setForm(f => ({ ...f, status: e.target.value as LocalSaleStatus }))}
                  className="w-full border border-[#e4e4e0] rounded px-2 py-1 text-xs">
                  <option value="pending">Ожидает подтверждения</option>
                  <option value="counted">Засчитано</option>
                  <option value="cancelled">Отменено</option>
                </select>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button onClick={addLocalSale} disabled={!form.amount || form.amount <= 0}
                  className="bg-[#111110] hover:bg-[#2a2a28] text-white text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-40">
                  Добавить
                </button>
                <button onClick={() => setShowAddForm(false)}
                  className="text-xs text-[#9a9a95] hover:text-[#111110]">Отмена</button>
              </div>
            </div>
          )}
        </div>

        {/* ── Таблица всех продаж ─────────────────────────────────────────────── */}
        <div className="bg-white border border-[#e4e4e0] rounded-lg overflow-hidden">
          <div className="px-3 py-2 bg-[#fafaf9] border-b border-[#e4e4e0] flex items-baseline justify-between">
            <div>
              <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Мои B2C-заказы и продажи</p>
              <p className="text-[10px] text-[#c4c4be] mt-0.5">B2B-продажи будут подключены отдельно по другим правилам.</p>
            </div>
            <p className="text-[10px] text-[#c4c4be]">{rows.length} строк</p>
          </div>
          {rows.length === 0 ? (
            <div className="p-6 text-center text-[#9a9a95] text-xs">Пока нет B2C-продаж. Добавьте через форму выше.</div>
          ) : (
            <>
              <div className="grid grid-cols-[80px_1fr_1fr_100px_90px_90px_60px] gap-2 px-3 py-1.5 border-b border-[#e4e4e0]">
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Дата</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Источник</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase">Клиент</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Сумма</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-center">Статус</span>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase text-right">В комиссию</span>
                <span />
              </div>
              {rows.map(r => {
                const st = STATUS_BADGES[r.statusKey] ?? STATUS_BADGES.draft
                return (
                  <div key={r.key}
                    className="grid grid-cols-[80px_1fr_1fr_100px_90px_90px_60px] gap-2 items-center px-3 py-1.5 border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                    <span className="text-[11px] text-[#6b6b66] font-mono">{r.date}</span>
                    <span className="text-[11px] text-[#4b4b47] truncate">{r.sourceLabel}</span>
                    <span className="text-[11px] text-[#6b6b66] truncate">{r.client}</span>
                    <span className="text-[11px] font-mono text-[#111110] text-right">{fmt(r.amount)}</span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded text-center ${st.color}`}>{st.label}</span>
                    <span className={`text-[11px] font-mono font-semibold text-right ${r.counted ? 'text-emerald-700' : 'text-[#c4c4be]'}`}>
                      {r.counted ? fmt(r.amount) : '—'}
                    </span>
                    {r.isLocal && r.localId ? (
                      <div className="flex items-center gap-1 justify-end">
                        {r.statusKey === 'pending' && (
                          <button onClick={() => setLocalStatus(r.localId!, 'counted')}
                            title="Засчитать"
                            className="text-[10px] text-emerald-700 hover:underline">✓</button>
                        )}
                        {r.statusKey !== 'cancelled' && (
                          <button onClick={() => setLocalStatus(r.localId!, 'cancelled')}
                            title="Отменить"
                            className="text-[10px] text-orange-500 hover:underline">×</button>
                        )}
                        <button onClick={() => deleteLocal(r.localId!)}
                          title="Удалить"
                          className="text-[10px] text-red-500 hover:underline">🗑</button>
                      </div>
                    ) : <span />}
                  </div>
                )
              })}
            </>
          )}
        </div>

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
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase text-right">Сделки</span>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase text-right">Комиссия</span>
              </div>
              {sortedMonthKeys.map(k => {
                const m = byMonth[k]
                const c = calculateProgressiveCommission(m.revenue, DEFAULT_MANAGER_COMMISSION_TIERS).totalCommission
                const tl = tierLabelFor(m.revenue)
                const isCurrent = k === nowKey
                return (
                  <div key={k}
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-2 border-b border-[#f5f5f3] last:border-0 ${
                      isCurrent ? 'bg-emerald-50/40' : 'hover:bg-[#fafaf9]'
                    }`}>
                    <span className="text-xs text-[#111110]">{monthLabel(k)}{isCurrent && <span className="text-[10px] text-emerald-600 ml-1.5">сейчас</span>}</span>
                    <span className="text-xs font-mono text-[#4b4b47] text-right whitespace-nowrap">{fmtM(m.revenue)}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-center whitespace-nowrap ${TIER_COLORS[tl] ?? TIER_COLORS['2%']}`}>{tl}</span>
                    <span className="text-xs font-mono text-[#9a9a95] text-right whitespace-nowrap">{m.dealCount} шт</span>
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
