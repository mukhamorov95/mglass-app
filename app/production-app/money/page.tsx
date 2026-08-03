'use client'

// «Деньги» цеха — read-only витрина финансов производства (санкция владельца):
// финмодель и ТБ-лесенка из CFO, сборка помесячно с 2026, план достижения ТБ-1.
// Доступ выдаёт владелец в /admin/users (галка «Деньги»); менять данные нельзя —
// правки только в /cfo/breakeven.

import { useEffect, useState } from 'react'
import ProductionTabs from '@/components/ProductionTabs'

type Money = {
  model: {
    revenuePlan: number
    marginPct: number
    fixed: number
    funds: { prodBonus: number }
    fundsRub: { prodBonus: number }
    tb0: number | null
    tb1: number | null
  } | null
  monthly: Record<string, { orders: number; amount: number }>
  monthlyReal?: Record<string, { cost: number; marginPct: number }>   // реальная маржа по факту — только для admin
  isAdmin?: boolean
  nowKey: string
  factThisMonth: { orders: number; amount: number }
  bonusTeam: { name: string; hiredAt: string | null; years: number | null; eligible: boolean }[]
}

const RUB = (n: number | null | undefined) => n == null ? '—' : Math.round(n).toLocaleString('ru-RU') + ' ₽'
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
type View = 'model' | 'monthly' | 'plan'

function TbRow({ level, sum, desc, tone }: { level: string; sum: string; desc: string; tone: string }) {
  return (
    <div className={`rounded-lg border px-4 py-3 ${tone}`}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-bold text-[15px]">{level}</span>
        <span className="font-mono font-semibold text-[15px]">{sum}</span>
      </div>
      <div className="text-[13px] mt-0.5 opacity-80">{desc}</div>
    </div>
  )
}

export default function MoneyPage() {
  const [view, setView] = useState<View>('model')
  const [data, setData] = useState<Money | null>(null)
  const [denied, setDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    const r = await fetch('/api/production/money')
    if (r.status === 403 || r.status === 401) { setDenied(true); setLoading(false); return }
    setData(await r.json())
    setLoading(false)
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load() }, [])

  const pill = (v: View, label: string) =>
    <button key={v} onClick={() => setView(v)}
      className={`text-[13px] font-medium px-3 py-1.5 rounded-full ${view === v ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#4b4b47] hover:border-[#111110]'}`}>
      {label}
    </button>

  const m = data?.model ?? null
  const fact = data?.factThisMonth.amount ?? 0
  const toTb1 = m?.tb1 != null ? m.tb1 - fact : null
  const pctTb1 = m?.tb1 ? Math.min(100, Math.round(fact / m.tb1 * 100)) : null

  const months = data ? Array.from({ length: 12 }, (_, i) => {
    const key = `2026-${String(i + 1).padStart(2, '0')}`
    return { key, label: MONTHS_RU[i], ...(data.monthly[key] ?? { orders: 0, amount: 0 }) }
  }).filter(r => r.orders > 0 || r.key <= data.nowKey) : []
  const totalOrders = months.reduce((s, r) => s + r.orders, 0)
  const totalAmount = months.reduce((s, r) => s + r.amount, 0)
  // Бонусный фонд месяца = маржа% × доля фонда (5%) от выручки — только если месяц
  // прошёл ТБ-1 (иначе маржа не покрывает постоянку, фонда нет).
  const bonusRate = m ? (m.marginPct / 100) * (m.funds.prodBonus / 100) : 0
  const monthBonus = (amount: number) =>
    (m?.tb1 != null && bonusRate > 0 && amount >= m.tb1) ? Math.round(amount * bonusRate) : null
  const totalBonus = months.reduce((s, r) => s + (monthBonus(r.amount) ?? 0), 0)
  // Реальная маржа по факту — приватная колонка только для admin (API отдаёт данные лишь ему).
  const showReal = !!(data?.isAdmin && data?.monthlyReal)
  const totalRealCost = months.reduce((s, r) => s + (data?.monthlyReal?.[r.key]?.cost ?? 0), 0)
  const totalRealMargin = totalAmount > 0 ? Math.round((1 - totalRealCost / totalAmount) * 1000) / 10 : 0

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110]">💰 Деньги производства</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Доходы, расходы и при каких оборотах появляется бонусный фонд. Только просмотр — цифры ведёт CFO.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-[860px] space-y-4">
        {loading && <div className="text-[#9a9a95] text-[14px]">Загрузка…</div>}
        {denied && (
          <div className="border border-amber-300 bg-amber-50 rounded-xl px-4 py-3 text-[14px]">
            🔒 Доступ к разделу выдаёт владелец. Если вам сюда нужно — попросите включить «Деньги» в вашем профиле.
          </div>
        )}

        {!loading && !denied && data && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {pill('model', '🎯 Финмодель и ТБ')}
              {pill('monthly', '📦 Сборка помесячно')}
              {pill('plan', '🚀 План к ТБ-1')}
            </div>

            {/* ── Финмодель и ТБ ── */}
            {view === 'model' && (m ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    ['План выручки, мес', RUB(m.revenuePlan)],
                    ['Маржа', `${m.marginPct}%`],
                    ['Постоянные расходы, мес', RUB(m.fixed)],
                    ['Факт этого месяца', RUB(fact)],
                  ].map(([l, v]) => (
                    <div key={l} className="bg-white border border-[#e4e4e0] rounded-lg px-3 py-2.5">
                      <div className="text-[11px] uppercase tracking-wide text-[#9a9a95]">{l}</div>
                      <div className="font-mono font-semibold text-[16px] text-[#111110] mt-0.5">{v}</div>
                    </div>
                  ))}
                </div>

                {m.tb1 != null && pctTb1 != null && (
                  <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-4">
                    <div className="flex items-baseline justify-between flex-wrap gap-2">
                      <span className="text-[14px] font-semibold text-[#111110]">Путь месяца к ТБ-1 (бонусный фонд)</span>
                      <span className="text-[13px] font-mono text-[#4b4b47]">
                        {toTb1 != null && toTb1 > 0 ? `осталось ${RUB(toTb1)}` : `ТБ-1 пройдена, сверх: ${RUB(fact - m.tb1)}`}
                      </span>
                    </div>
                    <div className="mt-2 h-3 rounded-full bg-[#f0f0ee] overflow-hidden">
                      <div className={`h-full rounded-full ${pctTb1 >= 100 ? 'bg-emerald-500' : pctTb1 >= 70 ? 'bg-amber-400' : 'bg-[#111110]'}`}
                        style={{ width: `${pctTb1}%` }} />
                    </div>
                    <div className="mt-1 text-[12px] text-[#9a9a95]">{pctTb1}% от ТБ-1 · выручка считается по заказам производства этого месяца</div>
                  </div>
                )}

                <div className="space-y-2">
                  <h2 className="text-[13px] uppercase tracking-wide text-[#9a9a95]">Уровни безубыточности</h2>
                  <TbRow level="ТБ-0 · в ноль" sum={RUB(m.tb0)}
                    desc="Выручка, при которой покрыты все переменные и постоянные расходы. Ниже — работаем в минус." tone="bg-white border-[#e4e4e0] text-[#111110]" />
                  <TbRow level={`ТБ-1 · + фонд бонусов производства (${m.funds.prodBonus}% от маржи)`} sum={RUB(m.tb1)}
                    desc={`Та самая «пенка»: сверх этого уровня копится фонд бонусов цеха ≈ ${RUB(m.fundsRub.prodBonus)}/мес при плане — делится между сотрудниками со стажем от 2 лет.`} tone="bg-emerald-50 border-emerald-200 text-emerald-900" />
                </div>
                {data.bonusTeam.length > 0 && (
                  <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
                    <h2 className="text-[13px] font-semibold text-[#111110]">Кто участвует в бонусном фонде <span className="text-[#9a9a95] font-normal">· стаж от 2 лет</span></h2>
                    <div className="mt-2 space-y-1">
                      {data.bonusTeam.map(u => (
                        <div key={u.name} className="flex items-center justify-between text-[13px]">
                          <span className={u.eligible ? 'text-[#111110]' : 'text-[#9a9a95]'}>{u.eligible ? '✅' : '—'} {u.name}</span>
                          <span className={`font-mono text-[12px] ${u.eligible ? 'text-emerald-700' : 'text-[#9a9a95]'}`}>
                            {u.years != null ? `${u.years} г.` : 'дата приёма не указана'}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-[#9a9a95] mt-2">Дата приёма заполняется владельцем в «Пользователях». Без даты сотрудник в фонде не участвует.</p>
                  </div>
                )}
                <p className="text-[12px] text-[#9a9a95]">Цифры из финмодели CFO (юнит «Производство»). Менять их здесь нельзя — правки в разделе CFO → Точка безубыточности.</p>
              </div>
            ) : (
              <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-4 text-[14px] text-[#4b4b47]">
                Финмодель производства ещё не заполнена в CFO → «Точка безубыточности».
              </div>
            ))}

            {/* ── Сборка помесячно ── */}
            {view === 'monthly' && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                <table className="w-full text-[14px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#9a9a95] border-b border-[#e4e4e0]">
                      <th className="px-4 py-2.5">Месяц · 2026</th>
                      <th className="px-4 py-2.5 text-right">Объектов</th>
                      <th className="px-4 py-2.5 text-right">Сумма</th>
                      <th className="px-4 py-2.5 text-right">Бонус · {m?.funds.prodBonus ?? 5}% от маржи</th>
                      {showReal && <th className="px-4 py-2.5 text-right text-[#111110]">🔒 Реальная маржа, ₽ <span className="normal-case tracking-normal text-[10px] text-[#9a9a95]">только вы</span></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {months.map(r => {
                      const bonus = monthBonus(r.amount)
                      return (
                      <tr key={r.key} className={`border-b border-[#f0f0ee] ${r.key === data.nowKey ? 'bg-[#fafaf8]' : ''}`}>
                        <td className="px-4 py-2.5 text-[#111110]">{r.label}{r.key === data.nowKey && <span className="ml-2 text-[11px] text-[#9a9a95]">текущий</span>}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{r.orders}</td>
                        <td className="px-4 py-2.5 text-right font-mono">{RUB(r.amount)}</td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {bonus != null
                            ? <span className="text-emerald-700 font-semibold">{RUB(bonus)}</span>
                            : <span className="text-[#c4c4be]">— ниже ТБ-1</span>}
                        </td>
                        {showReal && (() => {
                          const real = data.monthlyReal![r.key]
                          if (!real || r.amount <= 0) return <td className="px-4 py-2.5 text-right font-mono text-[#c4c4be]">—</td>
                          const marginRub = Math.round(r.amount - real.cost)
                          const good = m?.marginPct != null ? real.marginPct >= m.marginPct : real.marginPct >= 0
                          return <td className={`px-4 py-2.5 text-right font-mono font-semibold ${good ? 'text-emerald-700' : 'text-amber-700'}`}>{RUB(marginRub)} <span className="text-[10px] text-[#9a9a95] font-normal">{real.marginPct}%</span></td>
                        })()}
                      </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="font-semibold">
                      <td className="px-4 py-2.5">Итого</td>
                      <td className="px-4 py-2.5 text-right font-mono">{totalOrders}</td>
                      <td className="px-4 py-2.5 text-right font-mono">{RUB(totalAmount)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-emerald-700">{RUB(totalBonus)}</td>
                      {showReal && <td className={`px-4 py-2.5 text-right font-mono ${m?.marginPct != null && totalRealMargin >= m.marginPct ? 'text-emerald-700' : 'text-amber-700'}`}>{RUB(totalAmount - totalRealCost)} <span className="text-[10px] text-[#9a9a95] font-normal">{totalRealMargin}%</span></td>}
                    </tr>
                  </tfoot>
                </table>
                </div>
                {showReal && (
                  <p className="px-4 py-2.5 text-[11px] text-[#9a9a95] border-t border-[#f0f0ee]">
                    🔒 «Реальная маржа, ₽» — сколько маржи нагенерили по факту заказов месяца (выручка − себестоимость). Мелким — % от выручки. Зелёная ≥ план {m?.marginPct ?? 60}%, янтарная — ниже. Колонку видите только вы (админ).
                  </p>
                )}
              </div>
            )}

            {/* ── План к ТБ-1 ── */}
            {view === 'plan' && (
              <div className="space-y-4">
                <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-4">
                  <h2 className="text-[16px] font-bold text-[#111110]">Как дойти до ТБ-1 и выше</h2>
                  <p className="text-[13px] text-[#9a9a95] mt-0.5">ТБ-0 — выживаем. ТБ-1 — появляется бонусный фонд цеха. Дальше — фонды развития и цель.</p>
                  <ol className="mt-3 space-y-3">
                    <li className="flex gap-3">
                      <span className="w-7 h-7 rounded-lg bg-[#16181a] text-white font-extrabold text-[14px] flex items-center justify-center shrink-0">1</span>
                      <div className="text-[14px] leading-relaxed text-[#16181a]">
                        <b>Качество и срок.</b> Каждый заказ — вовремя и без брака. Возвраты и просрочки съедают маржу быстрее всего:
                        переделка = материал + работа × 2, а клиент со сорванным сроком не приносит следующий заказ.
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-7 h-7 rounded-lg bg-[#16181a] text-white font-extrabold text-[14px] flex items-center justify-center shrink-0">2</span>
                      <div className="text-[14px] leading-relaxed text-[#16181a]">
                        <b>Зеркала с подсветкой — производим весь продукт сами.</b> Себестоимость + надбавка за зеркала с подсветкой и рамой:
                        MR GLASS забирает у нас готовые конструкции и сам ничего не производит. Полный продукт вместо «продажи листов» — это рост среднего чека каждого заказа.
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <span className="w-7 h-7 rounded-lg bg-[#16181a] text-white font-extrabold text-[14px] flex items-center justify-center shrink-0">3</span>
                      <div className="text-[14px] leading-relaxed text-[#16181a]">
                        <b>Ту же услугу — сторонним компаниям.</b> Готовые конструкции (зеркала со светом, изделия под ключ) предлагаем
                        другим студиям и перепродавцам — растёт и средний чек, и количество заказов. Дилерские цены уже посчитаны в калькуляторе.
                      </div>
                    </li>
                  </ol>
                </div>

                <div className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-4">
                  <h2 className="text-[14px] font-bold text-[#111110]">Что включается на каждом уровне</h2>
                  <div className="mt-2 space-y-1.5 text-[14px] text-[#4b4b47]">
                    <div>🏁 <b>ТБ-0</b> — расходы покрыты, работаем в ноль.</div>
                    <div>🏭 <b>ТБ-1</b> — наполняется <b>фонд бонусов производства</b>: «пенка», которая делится между сотрудниками со стажем от 2 лет.</div>
                  </div>
                  <p className="text-[12px] text-[#9a9a95] mt-2">Конкретные суммы уровней — во вкладке «Финмодель и ТБ», они пересчитываются из модели CFO автоматически.</p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
