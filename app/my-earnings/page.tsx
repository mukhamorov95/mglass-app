'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { cumulativeCommission, currentTier, nextTier, tierIndex, TIERS } from '@/lib/commissionTiers'

type Calc = {
  id: number
  created_at: string
  product_type: string
  final_price: number
  margin: number
  manager_bonus: number
  status: string
}

type MonthStat = {
  key: string
  label: string
  approvedRevenue: number
  baseCommission: number
  upsellBonus: number
  total: number
  tierRate: string
  tierIdx: number
  dealCount: number
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft:    { label: 'Черновик',  color: 'bg-gray-100 text-gray-500' },
  sent:     { label: 'Отправлен', color: 'bg-blue-50 text-blue-600' },
  approved: { label: 'Принят',    color: 'bg-emerald-50 text-emerald-700' },
  rejected: { label: 'Отклонён', color: 'bg-red-50 text-red-500' },
}

const TYPE_LABELS: Record<string, string> = { mirror: 'Зеркало', loft: 'Лофт', shower: 'Душевая' }
const TYPE_DOT:   Record<string, string>  = { mirror: 'bg-blue-400', loft: 'bg-orange-400', shower: 'bg-cyan-400' }

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }
function fmtM(n: number) { return (n / 1_000_000).toFixed(1) + 'M' }

function monthKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string) {
  const [y, m] = key.split('-')
  const names = ['', 'Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']
  return `${names[parseInt(m)]} ${y}`
}

function buildMonthStats(calcs: Calc[]): MonthStat[] {
  const byMonth: Record<string, Calc[]> = {}
  for (const c of calcs) {
    const k = monthKey(c.created_at)
    if (!byMonth[k]) byMonth[k] = []
    byMonth[k].push(c)
  }
  return Object.entries(byMonth)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, deals]) => {
      const approved        = deals.filter(c => c.status === 'approved')
      const approvedRevenue = approved.reduce((s, c) => s + c.final_price, 0)
      const baseCommission  = cumulativeCommission(approvedRevenue)
      const tier            = currentTier(approvedRevenue)
      return {
        key,
        label: monthLabel(key),
        approvedRevenue,
        baseCommission,
        upsellBonus: 0,
        total:    baseCommission,
        tierRate: tier.label,
        tierIdx:  tierIndex(tier.label),
        dealCount: approved.length,
      }
    })
}

// Считает текущую серию завершённых месяцев на одном тире или выше
function calcStreak(monthStats: MonthStat[], nowKey: string) {
  const completed = monthStats.filter(m => m.key < nowKey)
  if (completed.length === 0) return { count: 0, tierIdx: 0, bonusEarned: false, nextBonusIn: 3 }
  const baseTierIdx = completed[0].tierIdx
  let count = 0
  for (const m of completed) {
    if (m.tierIdx >= baseTierIdx) count++
    else break
  }
  const bonusEarned  = count >= 3
  const nextBonusIn  = bonusEarned ? 3 - (count % 3) : 3 - count
  return { count, tierIdx: baseTierIdx, bonusEarned, nextBonusIn }
}

const TIER_COLORS: Record<string, string> = {
  '2%': 'bg-gray-100 text-gray-600',
  '3%': 'bg-blue-50 text-blue-700',
  '4%': 'bg-amber-50 text-amber-700',
  '5%': 'bg-emerald-50 text-emerald-700',
}
const TIER_BAR: Record<string, string> = {
  '2%': 'bg-gray-400',
  '3%': 'bg-blue-500',
  '4%': 'bg-amber-500',
  '5%': 'bg-emerald-500',
}

export default function MyEarningsPage() {
  const [calcs, setCalcs]     = useState<Calc[]>([])
  const [loading, setLoading] = useState(true)
  const [showDeals, setShowDeals] = useState(false)

  const [forbidden, setForbidden] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: userData } = await supabase
        .from('users').select('role').eq('id', user.id).single()
      if (userData?.role !== 'admin' && userData?.role !== 'manager') {
        setForbidden(true); setLoading(false); return
      }

      const { data } = await supabase
        .from('calculations')
        .select('id,created_at,product_type,final_price,margin,manager_bonus,status')
        .eq('created_by', user.id)
        .order('created_at', { ascending: false })
      setCalcs(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const nowKey       = monthKey(new Date().toISOString())
  const monthStats   = buildMonthStats(calcs)
  const streak       = calcStreak(monthStats, nowKey)

  const currentMonth = monthStats.find(m => m.key === nowKey)
  const curRevenue   = currentMonth?.approvedRevenue ?? 0
  const curTier      = currentTier(curRevenue)
  const curNext      = nextTier(curRevenue)
  const toNext       = curNext ? curNext.threshold - curRevenue : 0

  const totalApprovedRevenue = monthStats.reduce((s, m) => s + m.approvedRevenue, 0)
  const totalEarned          = monthStats.reduce((s, m) => s + m.total, 0)

  if (loading) return <div className="p-8 text-center text-[#9a9a95] text-xs">Загрузка...</div>
  if (forbidden) return <div className="p-8 text-center text-[#9a9a95] text-xs">Доступ только для менеджеров и администраторов</div>

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[900px] mx-auto px-4 py-4 space-y-3">

        {/* Шапка */}
        <div>
          <h1 className="text-sm font-semibold text-[#111110]">Мои заработки</h1>
          <p className="text-[10px] text-[#9a9a95] mt-0.5">Кумулятивная комиссия + серии</p>
        </div>

        {/* Текущий месяц */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-[10px] text-[#9a9a95] font-medium uppercase tracking-widest">Текущий месяц</p>
              <p className="text-xs text-[#4b4b47] mt-0.5">Принятые заказы: {fmt(curRevenue)}</p>
            </div>
            <div className="text-right">
              <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold ${TIER_COLORS[curTier.label]}`}>
                Тир {curTier.label}
              </span>
              <p className="text-xl font-bold font-mono text-emerald-700 mt-0.5">
                {fmt(currentMonth?.total ?? 0)}
              </p>
            </div>
          </div>

          {/* Прогресс до следующего тира */}
          <div className="space-y-1.5 mb-3">
            <div className="flex gap-1">
              {TIERS.map((t, i) => {
                const isPassed = curRevenue >= t.threshold
                const isActive = curTier.threshold === t.threshold
                return (
                  <div key={t.threshold} className="flex-1">
                    <div className={`h-1.5 rounded-full transition-all ${
                      isPassed ? TIER_BAR[t.label] : 'bg-[#e4e4e0]'
                    }`} />
                    <p className={`text-[9px] mt-0.5 font-medium ${
                      isActive ? 'text-[#111110]' : isPassed ? 'text-[#9a9a95]' : 'text-[#c4c4be]'
                    }`}>
                      {t.label}
                      {i > 0 && <span className="font-normal ml-0.5">{(t.threshold / 1_000_000).toFixed(0)}M</span>}
                    </p>
                  </div>
                )
              })}
            </div>
            {curNext ? (
              <p className="text-[10px] text-[#9a9a95]">
                До тира <span className={`font-semibold ${TIER_COLORS[curNext.label].split(' ')[1]}`}>{curNext.label}</span> осталось{' '}
                <span className="font-semibold text-[#111110]">{fmt(toNext)}</span>
                {' — '}заработаешь на{' '}
                <span className="font-semibold text-emerald-600">
                  +{fmt(cumulativeCommission(curRevenue + toNext) - (currentMonth?.total ?? 0))} больше
                </span>
              </p>
            ) : (
              <p className="text-[10px] text-emerald-600 font-semibold">Максимальный тир достигнут!</p>
            )}
          </div>

          {/* Стрик */}
          <div className={`rounded-lg px-3 py-2.5 border ${
            streak.bonusEarned
              ? 'bg-amber-50 border-amber-200'
              : streak.count >= 2
              ? 'bg-orange-50 border-orange-200'
              : 'bg-[#fafaf9] border-[#e4e4e0]'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {streak.count === 0 ? '🎯' : streak.count >= 3 ? '🔥' : streak.count === 2 ? '⚡' : '✨'}
                </span>
                <div>
                  <p className={`text-xs font-semibold ${streak.bonusEarned ? 'text-amber-700' : 'text-[#4b4b47]'}`}>
                    {streak.count === 0
                      ? 'Начни серию'
                      : `Серия: ${streak.count} ${streak.count === 1 ? 'месяц' : streak.count < 5 ? 'месяца' : 'месяцев'} подряд на тире ${TIERS[streak.tierIdx]?.label}`
                    }
                  </p>
                  <p className="text-[10px] text-[#9a9a95] mt-0.5">
                    {streak.bonusEarned
                      ? `Бонус за серию уже заработан! Следующий через ${streak.nextBonusIn} мес.`
                      : streak.count === 0
                      ? 'Держи один тир 3 месяца подряд — получи бонус'
                      : `До бонуса ещё ${streak.nextBonusIn} ${streak.nextBonusIn === 1 ? 'месяц' : 'месяца'}`
                    }
                  </p>
                </div>
              </div>
              {streak.tierIdx > 0 && (
                <div className="text-right flex-shrink-0">
                  <p className={`text-sm font-bold font-mono ${streak.bonusEarned ? 'text-amber-700' : 'text-[#9a9a95]'}`}>
                    {fmt(TIERS[streak.tierIdx].streakBonus)}
                  </p>
                  <p className="text-[9px] text-[#c4c4be]">бонус за серию</p>
                </div>
              )}
            </div>

            {/* Точки прогресса серии */}
            {streak.tierIdx > 0 && (
              <div className="flex gap-1.5 mt-2">
                {[0, 1, 2].map(i => {
                  const filled = i < (streak.count % 3 === 0 && streak.count > 0 ? 3 : streak.count % 3)
                  const completed = streak.count >= 3 && i < 3
                  return (
                    <div key={i} className={`flex-1 h-1.5 rounded-full transition-all ${
                      completed ? 'bg-amber-400' : filled ? 'bg-orange-400' : 'bg-[#e4e4e0]'
                    }`} />
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Мотивационный блок */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] px-4 py-3">
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2.5">
            К чему стремиться — пример за месяц
          </p>
          <div className="space-y-1.5">
            {[
              { revenue: 1_000_000, label: '1 млн' },
              { revenue: 2_000_000, label: '2 млн' },
              { revenue: 3_000_000, label: '3 млн' },
              { revenue: 4_000_000, label: '4 млн' },
              { revenue: 5_000_000, label: '5 млн' },
            ].map(ex => {
              const tier   = currentTier(ex.revenue)
              const comm   = cumulativeCommission(ex.revenue)
              const isPast = curRevenue >= ex.revenue
              return (
                <div key={ex.revenue}
                  className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                    isPast ? 'border-emerald-200 bg-emerald-50/60' : 'border-[#e4e4e0] bg-[#fafaf9]'
                  }`}>
                  <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isPast ? 'bg-emerald-500' : 'border-2 border-[#d4d4d0]'
                  }`}>
                    {isPast && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>

                  <p className={`text-sm font-bold w-12 flex-shrink-0 ${isPast ? 'text-emerald-700' : 'text-[#4b4b47]'}`}>
                    {ex.label}
                  </p>

                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${TIER_COLORS[tier.label]}`}>
                    {tier.label}
                  </span>

                  <div className="flex-1 flex gap-1 flex-wrap min-w-0">
                    {TIERS.map((t, i) => {
                      const from    = t.threshold
                      const to      = TIERS[i + 1]?.threshold ?? Infinity
                      const bracket = Math.min(ex.revenue, to) - from
                      if (bracket <= 0) return null
                      return (
                        <span key={t.threshold} className="text-[10px] text-[#9a9a95] whitespace-nowrap">
                          {(bracket / 1_000_000).toFixed(0)}M×{t.label}
                        </span>
                      )
                    })}
                  </div>

                  <p className={`text-sm font-bold font-mono flex-shrink-0 ${isPast ? 'text-emerald-700' : 'text-[#111110]'}`}>
                    {fmt(comm)}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Бонусы за серии */}
          <div className="mt-3 pt-3 border-t border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">
              Бонус за 3 месяца подряд на тире
            </p>
            <div className="flex gap-2">
              {TIERS.filter(t => t.streakBonus > 0).map(t => (
                <div key={t.label} className={`flex-1 rounded-lg px-2 py-1.5 border ${TIER_COLORS[t.label]} border-current/20`}>
                  <p className="text-xs font-bold">{t.label}</p>
                  <p className="text-sm font-bold font-mono">+{(t.streakBonus / 1000).toFixed(0)}k</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Итого */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5">
            <p className="text-[10px] text-emerald-600 font-medium mb-0.5">Заработано всего</p>
            <p className="text-lg font-bold font-mono text-emerald-700">{fmt(totalEarned)}</p>
            <p className="text-[10px] text-emerald-500 mt-0.5">за всё время</p>
          </div>
          <div className="bg-white border border-[#e4e4e0] rounded-lg px-3 py-2.5">
            <p className="text-[10px] text-[#9a9a95] font-medium mb-0.5">Принятая выручка</p>
            <p className="text-lg font-bold font-mono text-[#111110]">{fmt(totalApprovedRevenue)}</p>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">сумма всех заказов</p>
          </div>
        </div>

        {/* Разбивка по месяцам */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <div className="px-3 py-2 bg-[#fafaf9] border-b border-[#e4e4e0]">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">По месяцам</p>
          </div>
          {monthStats.length === 0 ? (
            <div className="p-6 text-center text-[#9a9a95] text-xs">Расчётов нет</div>
          ) : (
            <>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-1.5 border-b border-[#e4e4e0]">
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider">Месяц</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-right">Оборот</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-center">Тир</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-right">Сделки</span>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider text-right">Комиссия</span>
              </div>

              {monthStats.map((m, idx) => {
                // Стрик-иконка для завершённых месяцев
                const prevMonths   = monthStats.slice(idx)
                const streakLen    = (() => {
                  let n = 0
                  for (const pm of prevMonths) {
                    if (pm.key >= nowKey) continue
                    if (pm.tierIdx >= m.tierIdx) n++
                    else break
                  }
                  return n
                })()
                const showStreakBadge = m.key < nowKey && streakLen >= 3 && m.tierIdx > 0

                return (
                  <div key={m.key}
                    className={`grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-2 border-b border-[#f5f5f3] last:border-0 ${
                      m.key === nowKey ? 'bg-emerald-50/40' : 'hover:bg-[#fafaf9]'
                    }`}>
                    <div>
                      <div className="flex items-center gap-1">
                        <p className="text-xs text-[#111110] font-medium">{m.label}</p>
                        {showStreakBadge && <span className="text-[10px]">🔥</span>}
                      </div>
                    </div>
                    <span className="text-xs font-mono text-[#4b4b47] text-right whitespace-nowrap">
                      {fmtM(m.approvedRevenue)}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded text-center whitespace-nowrap ${TIER_COLORS[m.tierRate]}`}>
                      {m.tierRate}
                    </span>
                    <span className="text-xs font-mono text-[#9a9a95] text-right whitespace-nowrap">
                      {m.dealCount} шт
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-700 text-right whitespace-nowrap">
                      {fmt(m.total)}
                    </span>
                  </div>
                )
              })}

              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-2 bg-[#fafaf9] border-t border-[#e4e4e0]">
                <span className="text-xs font-semibold text-[#4b4b47]">Итого</span>
                <span className="text-xs font-mono font-semibold text-[#111110] text-right">{fmtM(totalApprovedRevenue)}</span>
                <span />
                <span />
                <span className="text-xs font-mono font-bold text-emerald-700 text-right">{fmt(totalEarned)}</span>
              </div>
            </>
          )}
        </div>

        {/* Детализация по сделкам */}
        <div className="bg-white rounded-lg border border-[#e4e4e0] overflow-hidden">
          <button onClick={() => setShowDeals(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-[#fafaf9] transition-colors">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Все расчёты</p>
            <svg className={`w-3.5 h-3.5 text-[#9a9a95] transition-transform ${showDeals ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showDeals && (
            <>
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-1.5 bg-[#fafaf9] border-t border-[#e4e4e0]">
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider">#</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider">Изделие</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-right">Цена</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-right">Маржа</span>
                <span className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider text-right">Бонус</span>
                <span className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wider text-center">Статус</span>
              </div>
              {calcs.map(c => {
                const st    = STATUS_LABELS[c.status] ?? STATUS_LABELS.draft
                const bonus = c.manager_bonus ?? 0
                return (
                  <div key={c.id}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-3 px-3 py-2 border-b border-[#f5f5f3] last:border-0 hover:bg-[#fafaf9]">
                    <span className="text-[10px] text-[#c4c4be] font-mono w-7">#{c.id}</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_DOT[c.product_type] ?? 'bg-gray-300'}`} />
                      <div className="min-w-0">
                        <p className="text-xs text-[#111110] truncate">{TYPE_LABELS[c.product_type] ?? c.product_type}</p>
                        <p className="text-[10px] text-[#c4c4be]">
                          {new Date(c.created_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-mono text-[#111110] text-right whitespace-nowrap">{fmt(c.final_price)}</span>
                    <span className={`text-xs font-medium text-right ${c.margin >= 35 ? 'text-emerald-600' : c.margin >= 25 ? 'text-amber-600' : 'text-red-500'}`}>
                      {c.margin}%
                    </span>
                    <span className={`text-xs font-mono font-semibold text-right whitespace-nowrap ${bonus > 0 ? 'text-emerald-600' : 'text-[#c4c4be]'}`}>
                      {bonus > 0 ? fmt(bonus) : '—'}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded text-center whitespace-nowrap ${st.color}`}>
                      {st.label}
                    </span>
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
