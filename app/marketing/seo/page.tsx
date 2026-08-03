import { createClient } from '@/lib/supabase-server'
import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { redirect } from 'next/navigation'

// Дашборд «SEO / Продвижение»: заявки с сайта msk.mglass.pro (crm_leads source='site').
// Воронка лид → квалификация → сделка → выручка + трекер цели месяца и разбивка по
// посадочным страницам (что конвертит — топливо для SEO-оптимизации).
// Данные общие с CRM: лид с сайта сразу на доске /crm. Тут — аналитический срез.

export const dynamic = 'force-dynamic'

const GOAL = 5_000_000 // цель выручки за месяц, ₽
const AVG_CHECK = 120_000 // средний чек, ₽
const BASE_CONV = 0.15 // базовая конверсия лид→сделка, пока нет своей статистики

const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const NUM = (n: number) => Math.round(n).toLocaleString('ru-RU')

type Lead = {
  id: number
  name: string | null
  phone: string | null
  product: string | null
  sizes: string | null
  est_amount: number | null
  stage: string
  qualified: boolean
  heat: string | null
  status: 'active' | 'won' | 'lost'
  note: string | null
  landing_page?: string | null
  utm?: Record<string, string> | null
  created_at: string
}

type Sale = { lead_id: number | null; amount: number | null; sale_date: string; status: string }

const fmtDT = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

export default async function SeoDashboardPage() {
  const supabase = await createClient()
  const role = await getRole()
  if (!role) redirect('/login')

  // Заявки с сайта. select('*') — устойчиво к отсутствию колонок landing_page/utm
  // (если миграция 20260803_crm_lead_site_meta ещё не прогнана).
  const { data: leadsRaw, error: leadsErr } = await supabase
    .from('crm_leads')
    .select('*')
    .eq('source', 'site')
    .order('created_at', { ascending: false })
    .limit(2000)

  const leads = (leadsRaw ?? []) as Lead[]
  const ids = leads.map((l) => l.id)

  // Выручка сделок, привязанных к лидам с сайта.
  let sales: Sale[] = []
  if (ids.length) {
    const { data: salesRaw } = await supabase
      .from('crm_sales')
      .select('lead_id, amount, sale_date, status')
      .in('lead_id', ids)
    sales = (salesRaw ?? []) as Sale[]
  }

  // ── Временные окна ──────────────────────────────────────────────────────────
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d7 = new Date(now.getTime() - 7 * 864e5)
  const d30 = new Date(now.getTime() - 30 * 864e5)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const dayOfMonth = now.getDate()
  const daysLeft = Math.max(1, daysInMonth - dayOfMonth + 1)

  const inRange = (s: string, from: Date) => new Date(s) >= from
  const leadsToday = leads.filter((l) => inRange(l.created_at, startOfDay)).length
  const leads7 = leads.filter((l) => inRange(l.created_at, d7)).length
  const leads30 = leads.filter((l) => inRange(l.created_at, d30)).length
  const leadsMonth = leads.filter((l) => inRange(l.created_at, monthStart)).length

  const qualified = leads.filter((l) => l.qualified).length
  const won = leads.filter((l) => l.status === 'won').length
  const lost = leads.filter((l) => l.status === 'lost').length
  const active = leads.filter((l) => l.status === 'active').length
  const totalLeads = leads.length

  // Конверсия по завершённым (won / (won+lost)) — честнее, чем won/всего с висящими.
  const decided = won + lost
  const convRate = decided > 0 ? won / decided : BASE_CONV

  // Выручка
  const saleMonth = sales.filter((s) => new Date(s.sale_date) >= monthStart)
  const revenueMonth = saleMonth.reduce((a, s) => a + (Number(s.amount) || 0), 0)
  const revenueAll = sales.reduce((a, s) => a + (Number(s.amount) || 0), 0)
  const dealsMonth = saleMonth.length

  // Трекер цели месяца
  const paceForecast = dayOfMonth > 0 ? (revenueMonth / dayOfMonth) * daysInMonth : 0
  const goalPct = Math.min(100, Math.round((revenueMonth / GOAL) * 100))
  const dealsNeeded = Math.ceil(GOAL / AVG_CHECK) // ~42
  const dealsLeft = Math.max(0, dealsNeeded - dealsMonth)
  const leadsNeededTotal = Math.ceil(dealsNeeded / convRate)
  const leadsLeft = Math.max(0, leadsNeededTotal - leadsMonth)
  const dailyLeadTarget = Math.ceil(leadsLeft / daysLeft)

  // ── Разбивки ────────────────────────────────────────────────────────────────
  type Agg = { key: string; count: number; qualified: number; won: number; est: number }
  const groupBy = (fn: (l: Lead) => string) => {
    const m = new Map<string, Agg>()
    for (const l of leads) {
      const key = fn(l) || '—'
      const a = m.get(key) ?? { key, count: 0, qualified: 0, won: 0, est: 0 }
      a.count++
      if (l.qualified) a.qualified++
      if (l.status === 'won') a.won++
      a.est += Number(l.est_amount) || 0
      m.set(key, a)
    }
    return [...m.values()].sort((x, y) => y.count - x.count)
  }
  const byPage = groupBy((l) => l.landing_page || '')
  const byProduct = groupBy((l) => l.product || '')
  const bySource = groupBy((l) => (l.utm?.source as string) || (l.utm?.referrer ? hostOf(l.utm.referrer) : 'прямой / SEO'))

  const recent = leads.slice(0, 20)

  // ── SEO-инсайты (что оптимизировать) ─────────────────────────────────────────
  const insights: string[] = []
  if (totalLeads === 0) {
    insights.push('Заявок с сайта пока нет. Как только придут первые — здесь появится разбор: какие страницы и запросы приводят клиентов, где теряем.')
  } else {
    const topPage = byPage[0]
    if (topPage && topPage.key !== '—') insights.push(`Больше всего заявок даёт «${topPage.key}» (${topPage.count}). Усилить эту страницу: добавить FAQ, кейсы, перелинковку на смежные — она уже работает.`)
    const deadPages = byPage.filter((p) => p.count >= 3 && p.qualified === 0)
    if (deadPages.length) insights.push(`Страницы с заявками, но без квалифицированных: ${deadPages.map((p) => p.key).slice(0, 3).join(', ')}. Трафик нецелевой — проверить заголовки/интент запроса.`)
    if (leadsMonth < leadsNeededTotal) insights.push(`Для цели ${NUM(GOAL / 1_000_000)} млн ₽ при текущей конверсии нужно ~${leadsNeededTotal} заявок/мес (${dailyLeadTarget}/день). Сейчас темп ${(leadsMonth / Math.max(1, dayOfMonth)).toFixed(1)}/день.`)
    if (won > 0) insights.push(`Конверсия лид→сделка: ${Math.round(convRate * 100)}%. Каждый +1% конверсии = −${NUM(leadsNeededTotal - Math.ceil(dealsNeeded / (convRate + 0.01)))} заявок к цели.`)
  }

  const paceTone = paceForecast >= GOAL ? 'text-emerald-600' : paceForecast >= GOAL * 0.6 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">SEO / Продвижение</h1>
          <p className="mt-1 text-sm text-neutral-500">Заявки с сайта msk.mglass.pro · воронка и цель месяца</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/crm" className="rounded-lg border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50">Доска CRM →</Link>
          <Link href="/marketing" className="rounded-lg border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50">Marketing Center</Link>
        </div>
      </div>

      {leadsErr && (
        <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 ring-1 ring-red-200">
          Не удалось загрузить заявки: {leadsErr.message}
        </div>
      )}

      {/* KPI */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Сегодня" value={String(leadsToday)} sub="заявок" tone="text-sky-600" />
        <Kpi label="7 дней" value={String(leads7)} sub="заявок" />
        <Kpi label="30 дней" value={String(leads30)} sub="заявок" />
        <Kpi label="Квалифицир." value={String(qualified)} sub={`из ${totalLeads}`} tone="text-emerald-600" />
        <Kpi label="Сделки (мес)" value={String(dealsMonth)} sub={`${won} won · ${lost} lost`} />
        <Kpi label="Выручка (мес)" value={NUM(revenueMonth)} sub="₽" tone="text-emerald-600" />
      </div>

      {/* Трекер цели месяца */}
      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold">Цель {MONTHS[now.getMonth()]}: {NUM(GOAL)} ₽</h2>
          <span className="text-sm text-neutral-500">средний чек {NUM(AVG_CHECK)} ₽ · {dealsNeeded} сделок · осталось {daysLeft} дн.</span>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-neutral-100">
          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${goalPct}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
          <span className="text-neutral-600">Сделано: <b>{RUB(revenueMonth)}</b> ({goalPct}%)</span>
          <span className={paceTone}>Прогноз по темпу: <b>{RUB(paceForecast)}</b></span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Mini label="Сделок закрыто" value={`${dealsMonth} / ${dealsNeeded}`} />
          <Mini label="Ещё сделок к цели" value={String(dealsLeft)} accent />
          <Mini label="Заявок нужно (мес)" value={`~${leadsNeededTotal}`} hint={`конв. ${Math.round(convRate * 100)}%`} />
          <Mini label="Темп заявок в день" value={`${dailyLeadTarget}`} hint={`осталось ${leadsLeft}`} accent />
        </div>
      </div>

      {/* Инсайты */}
      {insights.length > 0 && (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold text-amber-900">🔍 Что оптимизировать</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-amber-900/90">
            {insights.map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      )}

      {/* Разбивки */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Breakdown title="По посадочным страницам" subtitle="что конвертит трафик" rows={byPage} />
        <Breakdown title="По продукту" rows={byProduct} />
      </div>
      <div className="mt-4">
        <Breakdown title="По источнику" subtitle="откуда пришёл трафик (utm / реферер)" rows={bySource} />
      </div>

      {/* Последние заявки */}
      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <h2 className="text-lg font-semibold">Последние заявки</h2>
          <span className="text-sm text-neutral-400">{recent.length} из {totalLeads}</span>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-neutral-400">Заявок с сайта пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-neutral-400">
                <tr>
                  <th className="px-5 py-2 font-medium">Когда</th>
                  <th className="px-3 py-2 font-medium">Клиент</th>
                  <th className="px-3 py-2 font-medium">Продукт / размеры</th>
                  <th className="px-3 py-2 font-medium">~Сумма</th>
                  <th className="px-3 py-2 font-medium">Страница</th>
                  <th className="px-3 py-2 font-medium">Этап</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((l) => (
                  <tr key={l.id} className="border-t border-neutral-50 hover:bg-neutral-50/60">
                    <td className="whitespace-nowrap px-5 py-2.5 text-neutral-500">{fmtDT(l.created_at)}</td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-neutral-900">{l.name || '—'} {heatDot(l.heat)}</div>
                      <div className="text-xs text-neutral-400">{l.phone || ''}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div>{l.product || '—'}</div>
                      <div className="text-xs text-neutral-400">{l.sizes || ''}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-neutral-700">{l.est_amount ? RUB(l.est_amount) : '—'}</td>
                    <td className="max-w-[180px] truncate px-3 py-2.5 text-neutral-500" title={l.landing_page || ''}>{l.landing_page || '—'}</td>
                    <td className="px-3 py-2.5">
                      <Link href={`/crm/${l.id}`} className="text-sky-600 hover:underline">{l.stage}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-neutral-400">
        Заявки приходят с сайта и сразу попадают на доску <Link href="/crm" className="underline">CRM · Продажи</Link>. Выручка считается из «Отдел продаж» по сделкам, привязанным к лидам сайта.
      </p>
    </div>
  )
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url.slice(0, 40) }
}

function heatDot(heat: string | null) {
  const map: Record<string, string> = { hot: '🔴', warm: '🟠', cold: '⚪' }
  return heat && map[heat] ? <span title={heat}>{map[heat]}</span> : null
}

function Kpi({ label, value, sub, tone = 'text-neutral-900' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-neutral-400">{sub}</div>}
    </div>
  )
}

function Mini({ label, value, hint, accent = false }: { label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl p-3 ${accent ? 'bg-emerald-50 ring-1 ring-emerald-100' : 'bg-neutral-50'}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-neutral-900">{value}</div>
      {hint && <div className="text-[11px] text-neutral-400">{hint}</div>}
    </div>
  )
}

function Breakdown({ title, subtitle, rows }: { title: string; subtitle?: string; rows: { key: string; count: number; qualified: number; won: number; est: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-neutral-400">{subtitle}</span>}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400">Нет данных.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.slice(0, 8).map((r) => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-sm">
                <span className="max-w-[70%] truncate text-neutral-700" title={r.key}>{r.key}</span>
                <span className="tabular-nums text-neutral-500">{r.count} · {r.qualified}✓ · {r.won}💰</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full bg-sky-400" style={{ width: `${(r.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
