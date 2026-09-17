import Link from 'next/link'
import { OrphanCalcs } from './OrphanCalcs'
import { createClient } from '@/lib/supabase-server'
import { getSessionUser, getRole } from '@/lib/getRole'
import { seesAllDeals } from '@/lib/b2c/dealScope'
import { mskDate } from '@/lib/time'
import { telHref } from '@/lib/b2c/phoneKey'
import { pickUrgent, daysSince, plurDays, type MyDayDeal, type MyDayMeasure } from '@/lib/b2c/myDay'

// «Мой день» — что требует действия СЕГОДНЯ. Не сводка и не отчёт: только то,
// по чему нужно шевельнуться, и сразу ссылкой туда, где это делается.
//
// Порядок блоков — это и есть порядок работы, сверху вниз:
//   1. обещали связаться сегодня — дату назначил сам менеджер, она наступила;
//   2. замер сегодня и завтра — человек уже выезжает;
//   3. сделки без движения — главный разбор дня;
//   4. замер не назначен — заявка стоит и никуда не движется;
//   5. расчёты без клиента — хвосты, которые надо закрыть или убрать в архив.
// Первые два блока почти всегда пустые: это сегодняшние обязательства с
// конкретной датой, и если они есть — они важнее зависших сделок.
export const dynamic = 'force-dynamic'

export default async function MyDay() {
  const sb = await createClient()
  const user = await getSessionUser()
  const role = await getRole()

  // Право видеть чужое — то же, что в API сделок (seesAllDeals), иначе экран и
  // API расходятся: на одном менеджер видит чужое, на другом нет.
  const { data: profile } = user
    ? await sb.from('users').select('can_view_all_clients').eq('id', user.id).maybeSingle()
    : { data: null }
  const seeAll = seesAllDeals(role, profile?.can_view_all_clients as boolean | null)

  // Отказы и архив в «сегодня» не тянем: это закрытые сделки, а не работа на день.
  let dq = sb.from('deals')
    .select('id, client_name, phone, address, updated_at, next_contact_at, manager_id')
    .is('lost_at', null).is('archived_at', null)
    .order('updated_at', { ascending: true })
  if (!seeAll && user) dq = dq.eq('manager_id', user.id)
  const { data: dealsRaw } = await dq
  const deals = (dealsRaw ?? []) as MyDayDeal[]

  // Заявки на замер тоже по своему менеджеру: RLS на measure_requests открыт
  // всему персоналу, и без этого фильтра менеджер видел чужие заявки.
  let mq = sb.from('measure_requests')
    .select('id, deal_id, client_name, phone, address, scope, scheduled_at, status, manager_id, manager_name, created_at')
    .in('status', ['new', 'scheduled'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (!seeAll && user) mq = mq.eq('manager_id', user.id)
  const { data: mrRaw } = await mq
  const measures = (mrRaw ?? []) as MyDayMeasure[]

  const { promised, soon, unscheduled, stale, staleTotal } = pickUrgent(deals, measures)

  // Чья сделка — владельцу это первый вопрос к чужой карточке. Менеджеру своё
  // имя показывать незачем: в его списке все сделки его.
  const names = new Map<string, string>()
  if (seeAll) {
    const ids = [...new Set([...stale, ...promised].map(d => d.manager_id).filter(Boolean))] as string[]
    if (ids.length) {
      const { data: us } = await sb.from('users').select('id, name').in('id', ids)
      for (const u of us ?? []) names.set(u.id as string, (u.name as string) ?? '')
    }
  }
  // Имя менеджера идёт первым: строку обрезает по ширине, и приписанное в конец
  // имя видно не было бы.
  const withOwner = (d: MyDayDeal, base: string) => {
    const who = seeAll && d.manager_id ? names.get(d.manager_id) ?? null : null
    return who ? `${who} · ${base}` : base
  }
  const mgr = (m: MyDayMeasure) => (seeAll ? m.manager_name : null)

  const empty = promised.length === 0 && soon.length === 0 && unscheduled.length === 0 && stale.length === 0

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Мой день</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Что требует действия сегодня, сверху вниз. Остальное — в «Сделках».
            {seeAll && ' Показаны все менеджеры.'}
          </p>
        </div>

        {empty && (
          <div className="rounded-xl border border-[#e4e4e0] bg-white p-6 text-center">
            <p className="text-[14px] text-[#111110]">На сегодня ничего не горит.</p>
            <p className="text-[12px] text-[#9a9a95] mt-1">Никому не обещали перезвонить, замеров на сегодня и завтра нет, зависших сделок нет.</p>
          </div>
        )}

        {promised.length > 0 && (
          <Block title="Обещали связаться" count={promised.length} hint="дату назначили вы — она уже наступила">
            {promised.map(d => (
              <Row key={d.id} href={`/deal/${d.id}`}
                   left={d.client_name ?? 'Без имени'}
                   right={mskDate(d.next_contact_at!)}
                   sub={withOwner(d, [d.phone, d.address].filter(Boolean).join(' · ') || 'телефона и адреса нет')}
                   warn tel={d.phone} />
            ))}
          </Block>
        )}

        {soon.length > 0 && (
          <Block title="Замер сегодня и завтра" count={soon.length} hint="человек выезжает — проверьте адрес и телефон">
            {soon.map(m => (
              <Row key={m.id} href={m.deal_id ? `/deal/${m.deal_id}` : '/measure-requests'}
                   left={m.client_name ?? 'Без имени'}
                   right={m.scheduled_at ? mskDate(m.scheduled_at) : ''}
                   sub={[mgr(m), m.address ?? 'адрес не указан'].filter(Boolean).join(' · ')}
                   warn={!m.address} tel={m.phone} />
            ))}
          </Block>
        )}

        {stale.length > 0 && (
          <Block title="Сделки без движения" count={staleTotal} shown={stale.length}
                 hint="больше недели ничего не менялось — начните с самой старой"
                 more={staleTotal > stale.length ? { href: '/deals', label: `и ещё ${staleTotal - stale.length} в «Сделках»` } : undefined}>
            {stale.map(d => (
              <Row key={d.id} href={`/deal/${d.id}`}
                   left={d.client_name ?? 'Без имени'}
                   right={plurDays(daysSince(d.updated_at))}
                   sub={withOwner(d, [d.phone, d.address].filter(Boolean).join(' · ') || 'телефона и адреса нет')}
                   tel={d.phone} />
            ))}
          </Block>
        )}

        {unscheduled.length > 0 && (
          <Block title="Замер не назначен" count={unscheduled.length} hint="заявка есть, даты нет — она никуда не движется">
            {unscheduled.map(m => (
              <Row key={m.id} href={m.deal_id ? `/deal/${m.deal_id}` : '/measure-requests'}
                   left={m.client_name ?? 'Без имени'}
                   right={m.created_at ? `ждёт ${plurDays(daysSince(m.created_at))}` : 'назначить'}
                   // Чей клиент и что замерять — без этого строка не говорит ничего.
                   sub={[mgr(m), m.scope, m.address ?? 'адрес не указан'].filter(Boolean).join(' · ')}
                   warn={!m.address} tel={m.phone} />
            ))}
          </Block>
        )}

        <OrphanCalcs />

        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/deals" className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium">Все сделки →</Link>
          <Link href="/measure-requests" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">Замеры</Link>
          <Link href="/calculator/build" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">Новый расчёт</Link>
        </div>
      </div>
    </div>
  )
}

function Block({ title, hint, count, shown, more, children }: {
  title: string; hint: string; count: number; shown?: number
  more?: { href: string; label: string }; children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold text-[#111110]">
          {title} · {shown != null && shown < count ? `${shown} из ${count}` : count}
        </h2>
        <p className="text-[11px] text-[#9a9a95]">{hint}</p>
      </div>
      <div className="divide-y divide-[#f0f0ee]">{children}</div>
      {/* Обрезанный список без этой строки превращает счётчик в неправду. */}
      {more && (
        <Link href={more.href} className="block px-4 py-2 text-[12px] text-[#6b6b66] border-t border-[#f0f0ee] hover:bg-[#fafaf9]">
          {more.label} →
        </Link>
      )}
    </div>
  )
}

function Row({ href, left, right, sub, warn, tel }: { href: string; left: string; right: string; sub: string; warn?: boolean; tel?: string | null }) {
  const call = telHref(tel)
  return (
    <div className="relative flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#fafaf9]">
      <Link href={href} className="absolute inset-0" aria-label={left} />
      <div className="min-w-0 relative pointer-events-none">
        <p className="text-[13.5px] text-[#111110] truncate">{left}</p>
        <p className={`text-[11.5px] truncate ${warn ? 'text-amber-700' : 'text-[#9a9a95]'}`}>{sub}</p>
      </div>
      <span className="relative flex items-center gap-2 whitespace-nowrap">
        {/* Позвонить прямо из списка дел — не открывая сделку. */}
        {call && (
          <a href={call} className="text-[12px] font-semibold px-2 py-1 rounded-lg border border-[#e4e4e0] text-[#4b4b47] hover:border-[#111110] hover:text-[#111110] transition-colors">
            Позвонить
          </a>
        )}
        <span className="text-[12px] text-[#9a9a95]">{right}</span>
      </span>
    </div>
  )
}
