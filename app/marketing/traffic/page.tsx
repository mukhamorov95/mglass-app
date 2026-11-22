import Link from 'next/link'
import { amoGetAll } from '@/lib/amocrm'
import type { AmoLeadLite } from '@/lib/marketing/channels'
import { SITES } from '@/lib/marketing/sites'
import { aggregateWeeks, buildWeeks, delta, fetchMetrika, leadDatesFor, SOURCES, todayMoscow, type MetrikaRow, type WeekRow } from '@/lib/marketing/traffic'
import { MarketingTabs, requireMarketing } from '../MarketingTabs'
import { weekLabel, WeeklyChart } from './WeeklyChart'

export const dynamic = 'force-dynamic'

const SPANS = [8, 12, 26] as const

function Delta({ cur, prev }: { cur: number; prev: number }) {
  const d = delta(cur, prev)
  if (d === null) return <span className="text-[#9a9a95]">прошлая неделя: {prev}</span>
  const tone = d > 0 ? 'text-emerald-700' : d < 0 ? 'text-red-700' : 'text-[#9a9a95]'
  return (
    <span className={tone}>
      {d > 0 ? '+' : ''}{d}% к прошлой неделе ({prev})
    </span>
  )
}

export default async function MarketingTrafficPage({ searchParams }: { searchParams: Promise<{ site?: string; w?: string }> }) {
  await requireMarketing()
  const sp = await searchParams
  const span = SPANS.find((s) => String(s) === sp.w) ?? 12
  const picked = sp.site === 'all' ? SITES : SITES.filter((s) => s.slug === (sp.site ?? SITES[0].slug))
  const sites = picked.length ? picked : [SITES[0]]
  const siteKey = sites.length > 1 ? 'all' : sites[0].slug
  const link = (o: { site?: string; w?: number }) => `/marketing/traffic?site=${o.site ?? siteKey}&w=${o.w ?? span}`

  const today = todayMoscow()
  const weeks = buildWeeks(today, span)
  const from = weeks[0].from
  const token = process.env.YANDEX_METRIKA_TOKEN

  const metrika = token
    ? await Promise.all(sites.map((s) => fetchMetrika(s.metrikaId, from, today, token).then((rows) => ({ rows, error: null as string | null }), (e: unknown) => ({ rows: [] as MetrikaRow[], error: `${s.domain}: ${e instanceof Error ? e.message : String(e)}` }))))
    : []
  const metrikaErrors = metrika.flatMap((m) => (m.error ? [m.error] : []))

  let leadsError: string | null = null
  let leads: AmoLeadLite[] = []
  try {
    leads = await amoGetAll<AmoLeadLite>('/leads', { 'filter[created_at][from]': String(Date.parse(`${from}T00:00:00+03:00`) / 1000) }, 'leads')
  } catch (e) {
    leadsError = e instanceof Error ? e.message : String(e)
  }

  const rows: WeekRow[] = aggregateWeeks(weeks, metrika.flatMap((m) => m.rows), leadDatesFor(leads, sites.flatMap((s) => s.channels)))
  const full = rows.filter((r) => !r.partial)
  const last = full.at(-1)
  const prev = full.at(-2)
  const current = rows.at(-1)!
  const hasVisits = token && metrikaErrors.length < sites.length

  const tiles = [
    { label: 'Визиты', key: 'visits' as const },
    { label: 'С поиска Яндекс', key: 'yandex' as const },
    { label: 'С поиска Google', key: 'google' as const },
    { label: 'Заявок в amo', key: 'leads' as const },
  ]

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing/traffic" sub="Заходы на сайты по неделям с четверга по среду: откуда пришли и сколько оставили заявок" />

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {SITES.map((s) => (
          <Link key={s.slug} href={link({ site: s.slug })} className={`rounded-full border px-3 py-1 ${siteKey === s.slug ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white'}`}>
            {s.domain}
          </Link>
        ))}
        <Link href={link({ site: 'all' })} className={`rounded-full border px-3 py-1 ${siteKey === 'all' ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white'}`}>
          Все сайты
        </Link>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[#9a9a95]">Недель</span>
        {SPANS.map((s) => (
          <Link key={s} href={link({ w: s })} className={`rounded-full border px-3 py-1 ${s === span ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white'}`}>
            {s}
          </Link>
        ))}
      </div>

      {!token && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-medium">Визиты не подключены: в приложении нет токена Метрики.</div>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>oauth.yandex.ru → «Создать приложение» под аккаунтом, где лежат счётчики; доступ «Яндекс.Метрика: получение статистики», Redirect URI — https://oauth.yandex.ru/verification_code.</li>
            <li>Открыть https://oauth.yandex.ru/authorize?response_type=token&amp;client_id=&lt;ClientID приложения&gt; → «Разрешить» → скопировать токен.</li>
            <li>Vercel → проект → Settings → Environment Variables → YANDEX_METRIKA_TOKEN = токен (Production) → Redeploy.</li>
          </ol>
          <div className="mt-2">Пока токена нет, ниже считаются только заявки из amo.</div>
        </div>
      )}
      {metrikaErrors.length > 0 && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Визиты не загрузились — {metrikaErrors.join('; ')}. {metrikaErrors.length < sites.length ? 'Сумма ниже — без этого сайта.' : ''}
        </div>
      )}
      {leadsError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Заявки из amoCRM не загрузились ({leadsError}) — колонка «Заявок» пустая, а не ноль.</div>
      )}

      {last && (
        <section className="grid gap-3 sm:grid-cols-4">
          {tiles.map((t) => {
            const off = t.key === 'leads' ? !!leadsError : !hasVisits
            return (
              <div key={t.key} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
                <div className="text-sm text-[#9a9a95]">{t.label}</div>
                <div className="mt-1 text-3xl font-semibold tabular-nums text-[#111110]">{off ? '—' : last[t.key]}</div>
                <div className="mt-1 text-xs tabular-nums">{off || !prev ? <span className="text-[#9a9a95]">нет данных</span> : <Delta cur={last[t.key]} prev={prev[t.key]} />}</div>
                <div className="mt-1 text-xs tabular-nums text-[#9a9a95]">
                  сейчас идёт {weekLabel(current)}: {off ? '—' : current[t.key]}
                </div>
              </div>
            )
          })}
        </section>
      )}
      {last && <p className="mt-2 text-xs text-[#9a9a95]">Плитки — последняя полная неделя {weekLabel(last)} (чт–ср) против предыдущей.</p>}

      {hasVisits && (
        <section className="mt-6 rounded-xl border border-[#e4e4e0] bg-white p-4">
          <h2 className="mb-2 font-semibold text-[#111110]">Визиты по неделям</h2>
          <WeeklyChart weeks={rows} />
        </section>
      )}

      <section className="mt-6 overflow-x-auto rounded-xl border border-[#e4e4e0] bg-white">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[#9a9a95]">
            <tr>
              <th className="px-4 py-3 font-medium">Неделя (чт–ср)</th>
              <th className="px-2 py-3 text-right font-medium">Визиты</th>
              {SOURCES.map((s) => (
                <th key={s.key} className="px-2 py-3 text-right font-medium normal-case">{s.label}</th>
              ))}
              <th className="px-2 py-3 text-right font-medium">Просмотры</th>
              <th className="px-3 py-3 text-right font-medium">Заявок</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.from} className="border-t border-[#e4e4e0]">
                <td className="px-4 py-2 tabular-nums">
                  {weekLabel(r)}
                  {r.partial && <span className="ml-1 text-xs text-[#9a9a95]">идёт</span>}
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums">{hasVisits ? r.visits : '—'}</td>
                {SOURCES.map((s) => (
                  <td key={s.key} className="px-2 py-2 text-right tabular-nums">{hasVisits ? r[s.key] : '—'}</td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums">{hasVisits ? r.pageviews : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{leadsError ? '—' : r.leads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="mt-2 text-xs text-[#9a9a95]">
        Визиты — Метрика, без роботов, источник по последнему значимому переходу (как в отчёте «Источники, сводка»); наши собственные проверки сайта
        попадают в «Прямые заходы». Заявки — сделки amo этого сайта по дате создания, тот же признак канала, что на вкладке «Статистика».
      </p>
    </div>
  )
}
