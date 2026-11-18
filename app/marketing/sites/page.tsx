import { NEW_SITE_CHECKLIST, SITES } from '@/lib/marketing/sites'
import { MarketingTabs, requireMarketing } from '../MarketingTabs'

export default async function MarketingSitesPage() {
  await requireMarketing()
  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing/sites" sub="Все сайты компании: на чём работают, чем считаются, куда идут заявки" />

      <div className="grid gap-3">
        {SITES.map((s) => (
          <article key={s.domain} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <a href={s.url} target="_blank" rel="noopener" className="text-lg font-semibold text-[#111110] hover:underline">
                {s.domain} ↗
              </a>
              <span className="text-sm text-[#9a9a95]">{s.about}</span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
              <dt className="text-[#9a9a95]">Движок</dt><dd>{s.engine}</dd>
              <dt className="text-[#9a9a95]">Выкладка</dt><dd>{s.deploy}</dd>
              <dt className="text-[#9a9a95]">Метрика</dt><dd className="tabular-nums">{s.metrika}</dd>
              <dt className="text-[#9a9a95]">Цели</dt><dd>{s.goals}</dd>
              <dt className="text-[#9a9a95]">Поиск</dt><dd>{s.search}</dd>
              <dt className="text-[#9a9a95]">Заявки</dt><dd>{s.leads}</dd>
              <dt className="text-[#9a9a95]">Ссылается на</dt><dd>{s.linksTo.length ? s.linksTo.join(', ') : '—'}</dd>
            </dl>
          </article>
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-dashed border-[#e4e4e0] p-4">
        <h2 className="font-semibold text-[#111110]">Новый сайт — чтобы считался с первого дня</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[#111110]/80">
          {NEW_SITE_CHECKLIST.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ol>
      </section>
    </div>
  )
}
