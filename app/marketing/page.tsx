import Link from 'next/link'
import { amoGetAll } from '@/lib/amocrm'
import { aggregate, CHANNELS, periodStart, type AmoLeadLite } from '@/lib/marketing/channels'
import { SITES } from '@/lib/marketing/sites'
import { MarketingTabs, requireMarketing } from './MarketingTabs'

export const dynamic = 'force-dynamic'

const PERIODS = [7, 30, 90] as const

export default async function MarketingStatsPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  await requireMarketing()
  const { d } = await searchParams
  const days = PERIODS.find((p) => String(p) === d) ?? 30
  const from = periodStart(days)

  let leads: AmoLeadLite[] = []
  let error: string | null = null
  try {
    leads = await amoGetAll<AmoLeadLite>('/leads', { 'filter[created_at][from]': String(from) }, 'leads')
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const rows = aggregate(leads)
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]))
  const label = Object.fromEntries(CHANNELS.map((c) => [c.key, c]))
  const shown = rows.filter((r) => r.total > 0 || label[r.key].site)

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing" sub="Заявки из amoCRM по каналам: откуда пришли и чем закончились" />

      <div className="mb-5 flex items-center gap-2 text-sm">
        <span className="text-[#9a9a95]">Создано за</span>
        {PERIODS.map((p) => (
          <Link key={p} href={`/marketing?d=${p}`} className={`rounded-full border px-3 py-1 ${p === days ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white'}`}>
            {p} дней
          </Link>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Не удалось загрузить сделки из amoCRM: {error}. Обновите страницу.
        </div>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            {SITES.map((s) => {
              const r = s.channels.map((k) => byKey[k])
              const total = r.reduce((n, x) => n + x.total, 0)
              const won = r.reduce((n, x) => n + x.won, 0)
              return (
                <div key={s.domain} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
                  <div className="text-sm text-[#9a9a95]">{s.domain}</div>
                  <div className="mt-1 text-3xl font-semibold tabular-nums text-[#111110]">{total}</div>
                  <div className="text-xs text-[#9a9a95]">заявок · успешно {won}</div>
                </div>
              )
            })}
          </section>

          {byKey.envyboxChat.stuckQualification > 0 && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Чат Envybox: {byKey.envyboxChat.stuckQualification} из {byKey.envyboxChat.total} заявок стоят в воронке «Квалификация» и не
              попали в «Продажи» — менеджеры их не видят.
            </div>
          )}

          <section className="mt-6 overflow-x-auto rounded-xl border border-[#e4e4e0] bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-[#9a9a95]">
                <tr>
                  <th className="px-4 py-3 font-medium">Канал</th>
                  <th className="px-3 py-3 text-right font-medium">Заявок</th>
                  <th className="px-3 py-3 text-right font-medium">В работе</th>
                  <th className="px-3 py-3 text-right font-medium">Успешно</th>
                  <th className="px-3 py-3 text-right font-medium">Не реализовано</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-t border-[#e4e4e0]">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#111110]">{label[r.key].label}</div>
                      <div className="text-xs text-[#9a9a95]">{label[r.key].hint}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{r.total}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.open}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.won}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.lost}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#e4e4e0] bg-[#f5f5f3] font-semibold">
                  <td className="px-4 py-2.5">Всего</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{leads.length}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.open, 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.won, 0)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{rows.reduce((n, r) => n + r.lost, 0)}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <p className="mt-2 text-xs text-[#9a9a95]">
            Каналы без заявок за период скрыты, кроме сайтов. Канал — по тегу, полю «Источник сделки» и utm; если менеджер их не поставил,
            сделка попадает в «Без признака».
          </p>
        </>
      )}

      <section className="mt-6 rounded-xl border border-dashed border-[#e4e4e0] p-4 text-sm">
        <div className="font-medium text-[#111110]">Не подключено</div>
        <ul className="mt-2 space-y-1 text-[#9a9a95]">
          <li>Визиты и переходы по сайтам — вкладка «Посещаемость» (нужен токен Метрики)</li>
          <li>Страницы в поиске — нужен доступ к API Вебмастера и Search Console</li>
          <li>Публикации на площадках — появятся с реестром публикаций (этап Э1)</li>
        </ul>
      </section>
    </div>
  )
}
