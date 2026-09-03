import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { getSessionUser, getRole } from '@/lib/getRole'
import { mskDate, mskDayKey } from '@/lib/time'

// «Мой день» — что требует действия СЕГОДНЯ. Не сводка и не отчёт: только то,
// по чему нужно шевельнуться, и сразу ссылкой туда, где это делается.
//
// Почему не «все сделки»: список из сорока карточек не говорит, за какую браться.
// Здесь три группы, и каждая отвечает на вопрос «почему это здесь».
export const dynamic = 'force-dynamic'

type Deal = { id: number; client_name: string | null; phone: string | null; address: string | null; updated_at: string }
type MR = { id: number; deal_id: number | null; client_name: string | null; address: string | null; scheduled_at: string | null; status: string | null }

const DAY = 86400000


// Отбор вынесен из компонента: время нельзя брать в теле рендера — результат
// становится нестабильным при повторной отрисовке (правило react-hooks/purity).
function pickUrgent(deals: Deal[], measures: MR[]) {
  const now = Date.now()
  const today = mskDayKey(new Date(now))
  const tomorrow = mskDayKey(new Date(now + DAY))
  return {
    // Замер сегодня или завтра — самое срочное: человек уже выехал или выедет.
    soon: measures.filter(m => {
      if (!m.scheduled_at) return false
      const k = mskDayKey(new Date(m.scheduled_at))
      return k === today || k === tomorrow
    }),
    // Заявка без даты — её никто не назначил, и она молча стоит.
    unscheduled: measures.filter(m => !m.scheduled_at),
    // Сделка без движения неделю: не «плохо», а «вспомни».
    stale: deals.filter(d => now - new Date(d.updated_at).getTime() > 7 * DAY).slice(0, 12),
  }
}

export default async function MyDay() {
  const sb = await createClient()
  const user = await getSessionUser()
  const role = await getRole()
  const owner = role === 'admin' || role === 'ceo'

  // Менеджер видит своё; владелец — всё. Это то же правило, что в карточке сделки.
  let dq = sb.from('deals').select('id, client_name, phone, address, updated_at').order('updated_at', { ascending: true })
  if (!owner && user) dq = dq.eq('manager_id', user.id)
  const { data: dealsRaw } = await dq
  const deals = (dealsRaw ?? []) as Deal[]

  const { data: mrRaw } = await sb
    .from('measure_requests')
    .select('id, deal_id, client_name, address, scheduled_at, status')
    .in('status', ['new', 'scheduled'])
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  const measures = (mrRaw ?? []) as MR[]

  const { soon, unscheduled, stale } = pickUrgent(deals, measures)

  const empty = soon.length === 0 && unscheduled.length === 0 && stale.length === 0

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Мой день</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">Что требует действия сегодня. Остальное — в «Сделках».</p>
        </div>

        {empty && (
          <div className="rounded-xl border border-[#e4e4e0] bg-white p-6 text-center">
            <p className="text-[14px] text-[#111110]">На сегодня ничего не горит.</p>
            <p className="text-[12px] text-[#9a9a95] mt-1">Замеров на сегодня и завтра нет, зависших сделок нет.</p>
          </div>
        )}

        {soon.length > 0 && (
          <Block title="Замер сегодня и завтра" hint="человек выезжает — проверьте адрес и телефон">
            {soon.map(m => (
              <Row key={m.id} href={m.deal_id ? `/deal/${m.deal_id}` : '/measure-requests'}
                   left={m.client_name ?? 'Без имени'}
                   right={m.scheduled_at ? mskDate(m.scheduled_at) : ''}
                   sub={m.address ?? 'адрес не указан'} warn={!m.address} />
            ))}
          </Block>
        )}

        {unscheduled.length > 0 && (
          <Block title="Замер не назначен" hint="заявка есть, даты нет — она никуда не движется">
            {unscheduled.map(m => (
              <Row key={m.id} href={m.deal_id ? `/deal/${m.deal_id}` : '/measure-requests'}
                   left={m.client_name ?? 'Без имени'} right="назначить"
                   sub={m.address ?? 'адрес не указан'} warn={!m.address} />
            ))}
          </Block>
        )}

        {stale.length > 0 && (
          <Block title="Сделки без движения" hint="больше недели ничего не менялось">
            {stale.map(d => (
              <Row key={d.id} href={`/deal/${d.id}`}
                   left={d.client_name ?? 'Без имени'}
                   right={mskDate(d.updated_at)}
                   sub={[d.phone, d.address].filter(Boolean).join(' · ') || 'телефона и адреса нет'} />
            ))}
          </Block>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/deals" className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-medium">Все сделки →</Link>
          <Link href="/calculator/build" className="px-4 py-2 rounded-lg border border-[#e4e4e0] bg-white text-[13px]">Новый расчёт</Link>
        </div>
      </div>
    </div>
  )
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold text-[#111110]">{title}</h2>
        <p className="text-[11px] text-[#9a9a95]">{hint}</p>
      </div>
      <div className="divide-y divide-[#f0f0ee]">{children}</div>
    </div>
  )
}

function Row({ href, left, right, sub, warn }: { href: string; left: string; right: string; sub: string; warn?: boolean }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#fafaf9]">
      <div className="min-w-0">
        <p className="text-[13.5px] text-[#111110] truncate">{left}</p>
        <p className={`text-[11.5px] truncate ${warn ? 'text-amber-700' : 'text-[#9a9a95]'}`}>{sub}</p>
      </div>
      <span className="text-[12px] text-[#9a9a95] whitespace-nowrap">{right}</span>
    </Link>
  )
}
