import Link from 'next/link'
import { mskDayKey } from '@/lib/time'
import { redirect } from 'next/navigation'
import { getRole, ROLE_HOME } from '@/lib/getRole'
import MyDay from '@/components/MyDay'
import { OrphanCalcs } from '@/components/OrphanCalcs'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient as serviceClient } from '@/lib/supabase-service'
import { loadMorning, type Morning, type MorningPerson } from '@/lib/morningData'
import { loadTeam, type Team } from '@/lib/morningTeam'
import { parseView, type View } from '@/lib/morning'
import MorningManager from '@/components/morning/MorningManager'
import MorningTeam from '@/components/morning/MorningTeam'

const DAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

// Старые блоки под «Утром» сняты 08.10: «Выручка (согл.)» из расчётов была третьей
// цифрой выручки рядом с /cfo и книгой, а плитки Owner Center повторяли меню.

type Search = { m?: string; d?: string; from?: string; to?: string; month?: string; year?: string }

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const role = await getRole()
  // Роль-старт: специализированные роли уходят сразу в свой раздел, а не на
  // менеджерскую панель. manager/admin/ceo не в карте — остаются здесь.
  const home = role ? ROLE_HOME[role] : undefined
  if (home) redirect(home)
  const supabase = await createClient()

  // Главная рендерится на сервере, а он в UTC: с полуночи до трёх ночи по Москве
  // «сегодня» здесь было вчерашним — и подпись даты, и границы выборок за день.
  const now = new Date()
  const todayStr  = mskDayKey(now)
  const mskNow    = new Date(`${todayStr}T12:00:00Z`)   // полдень мск-дня: день недели и число берём из него
  const dateLabel = `${DAYS[mskNow.getUTCDay()]}, ${mskNow.getUTCDate()} ${MONTHS[mskNow.getUTCMonth()]}`

  // «Утро» (docs/MANAGER_MORNING_ROUTE.md, М2–М3): менеджер видит только себя — его
  // amo-id берётся из учётки, а не из адреса; владелец видит команду и любого по ?m=.
  const isOwner = role === 'admin' || role === 'ceo'
  let morning: Morning | null = null
  let team: Team | null = null
  let view: View = { kind: 'auto' }
  let viewError: string | undefined
  let person: MorningPerson | undefined
  let ownerView = false
  if (role === 'manager') {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: me } = user
      ? await supabase.from('users').select('amo_user_id').eq('id', user.id).maybeSingle()
      : { data: null }
    if (me?.amo_user_id) {
      morning = await loadMorning(serviceClient(), { today: todayStr, only: Number(me.amo_user_id) })
      person = morning.people[0]
    }
  } else if (isOwner) {
    // Выбор дня и периода (?d, ?month, ?year, ?from&to) — только у владельца.
    const sp = await searchParams
    const parsed = parseView(sp, todayStr)
    view = parsed.view
    viewError = parsed.error
    if (sp.m && /^\d+$/.test(sp.m)) {
      // На «Утре» одного менеджера выбирается только день; период — на «Команде».
      if (view.kind === 'range') view = { kind: 'auto' }
      morning = await loadMorning(serviceClient(), { today: todayStr, only: Number(sp.m), day: view.kind === 'day' ? view.day : undefined })
      person = morning.people[0]
      ownerView = true
    } else {
      team = await loadTeam(serviceClient(), { today: todayStr, view })
    }
  }
  const title = person
    ? (ownerView ? `Утро — ${person.name}` : `Доброе утро, ${person.name}`)
    : isOwner ? 'Доброе утро' : 'Панель менеджера'

  return (
    <div className="max-w-[960px] mx-auto px-5 py-8 space-y-8">

      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-[#9a9a95]">{dateLabel}</p>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight mt-0.5">{title}</h1>
        </div>
        <Link href="/calculations"
          className="text-[13px] text-blue-600 hover:underline font-medium">
          Все расчёты →
        </Link>
      </div>

      {viewError && <p role="alert" className="text-[12px] text-[#c23a2b]">Показан последний рабочий день: {viewError}.</p>}
      {(morning ?? team) && (morning ?? team)!.errors.length > 0 && (
        <p role="alert" className="text-[12px] text-[#c23a2b]">Не всё загрузилось: {(morning ?? team)!.errors.join(' · ')}</p>
      )}
      {morning && person && <MorningManager morning={morning} person={person} ownerView={ownerView} view={ownerView ? view : undefined} />}
      {/* Учётка без связи с amo — «Утра» нет, остаются поводы дня */}
      {role === 'manager' && !person && <MyDay />}
      {isOwner && team && <MorningTeam team={team} />}
      {/* Был на /my-day (менеджер и владелец); страница теперь ведёт сюда. */}
      {(role === 'manager' || isOwner) && <OrphanCalcs />}
    </div>
  )
}
