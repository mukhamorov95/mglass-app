import { amoGetAll } from '@/lib/amocrm'
import type { AmoLeadLite } from '@/lib/marketing/channels'
import { leadsByPublication, leadsSince, PLATFORMS, PUB_STATUS, trackedUrl, type ContentObject, type Publication } from '@/lib/marketing/publications'
import { serviceAsMe } from '@/lib/serviceAs'
import { MarketingTabs, requireMarketing } from '../MarketingTabs'
import { CopyLink, MarkPublishedForm, NewObjectForm, NewPublicationForm } from './Forms'

export const dynamic = 'force-dynamic'

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('ru-RU') : '—')
const platformLabel = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.label]))

export default async function MarketingObjectsPage() {
  await requireMarketing()
  const db = await serviceAsMe()
  const [o, p] = await Promise.all([
    db.from('content_objects').select('id, slug, title, product, district, site, page_url, status').order('created_at', { ascending: false }),
    db.from('content_publications').select('id, object_id, platform, url, target_url, utm_source, utm_medium, utm_campaign, utm_content, status, published_at').order('created_at'),
  ])
  const loadError = o.error?.message ?? p.error?.message ?? null
  const objects = (o.data ?? []) as ContentObject[]
  const pubs = (p.data ?? []) as Publication[]

  let leadsError: string | null = null
  let byPub = new Map<string, AmoLeadLite[]>()
  const tracked = pubs.filter((x) => x.utm_content)
  if (tracked.length) {
    try {
      const leads = await amoGetAll<AmoLeadLite>('/leads', { 'filter[created_at][from]': String(leadsSince(tracked)) }, 'leads')
      byPub = leadsByPublication(leads, tracked)
    } catch (e) {
      leadsError = e instanceof Error ? e.message : String(e)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      <MarketingTabs active="/marketing/objects" sub="Объект → его публикации → заявки по UTM-ссылке. Адрес и данные клиента сюда не пишутся" />

      {loadError && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Не удалось загрузить реестр: {loadError}. Обновите страницу.</div>
      )}
      {leadsError && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Заявки из amoCRM не загрузились ({leadsError}) — колонка «Заявок» пустая, а не ноль.</div>
      )}

      <div className="grid gap-4">
        {objects.map((obj) => {
          const list = pubs.filter((x) => x.object_id === obj.id)
          return (
            <article key={obj.id} className="rounded-xl border border-[#e4e4e0] bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-[#111110]">{obj.title}</h2>
                <span className="text-sm text-[#9a9a95]">{[obj.product, obj.district, obj.site].filter(Boolean).join(' · ')}</span>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[#9a9a95]">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Площадка</th>
                      <th className="py-2 pr-3 font-medium">Статус</th>
                      <th className="py-2 pr-3 font-medium">Вышло</th>
                      <th className="py-2 pr-3 font-medium">Ссылка для поста</th>
                      <th className="py-2 text-right font-medium">Заявок</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x) => (
                      <tr key={x.id} className="border-t border-[#e4e4e0] align-top">
                        <td className="py-2 pr-3">
                          {x.url ? <a href={x.url} target="_blank" rel="noopener" className="hover:underline">{platformLabel[x.platform]} ↗</a> : platformLabel[x.platform]}
                        </td>
                        <td className="py-2 pr-3">{PUB_STATUS[x.status]}</td>
                        <td className="py-2 pr-3 tabular-nums">{fmtDate(x.published_at)}</td>
                        <td className="py-2 pr-3">
                          {x.utm_content ? <CopyLink url={trackedUrl(x)} /> : <span className="text-xs text-[#9a9a95]">сама страница — заявки считаются по каналу «Сайт зеркал»</span>}
                          {x.status !== 'published' && <div className="mt-2"><MarkPublishedForm id={x.id} /></div>}
                        </td>
                        <td className="py-2 text-right tabular-nums">{!x.utm_content || leadsError ? '—' : (byPub.get(x.id)?.length ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 border-t border-[#e4e4e0] pt-3">
                <div className="mb-2 text-xs text-[#9a9a95]">Новая публикация объекта</div>
                <NewPublicationForm objectId={obj.id} pageUrl={obj.page_url} />
              </div>
            </article>
          )
        })}
        {!loadError && objects.length === 0 && <p className="text-sm text-[#9a9a95]">Объектов пока нет — добавьте первый ниже.</p>}
      </div>

      <section className="mt-6 rounded-xl border border-dashed border-[#e4e4e0] p-4">
        <h2 className="mb-3 font-semibold text-[#111110]">Новый объект</h2>
        <NewObjectForm />
      </section>

      <p className="mt-4 text-xs text-[#9a9a95]">
        Заявка считается за публикацией, когда человек пришёл по её ссылке и оставил заявку через форму на той же странице: форма кладёт
        utm_campaign и utm_content в сделку amo. Просмотры и переходы площадок — следующий этап (Метрика по UTM, статистика VK и Telegram).
      </p>
    </div>
  )
}
