import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

const DAYS = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

function fmt(n: number) { return n.toLocaleString('ru-RU') + ' ₽' }

const CALC_CARDS = [
  {
    href: '/calculator/shower',
    emoji: '🚿',
    label: 'Душевая',
    desc: 'Любая модель, стекло, фурнитура',
    color: 'from-cyan-500 to-cyan-600',
    bg: 'bg-cyan-50 border-cyan-200 hover:border-cyan-400',
  },
  {
    href: '/calculator/mirror',
    emoji: '🪞',
    label: 'Зеркало',
    desc: 'LED, форма, пескоструй, допы',
    color: 'from-blue-500 to-blue-600',
    bg: 'bg-blue-50 border-blue-200 hover:border-blue-400',
  },
  {
    href: '/calculator/loft',
    emoji: '🏗️',
    label: 'Лофт',
    desc: 'Секции, фурнитура, покраска',
    color: 'from-orange-500 to-orange-600',
    bg: 'bg-orange-50 border-orange-200 hover:border-orange-400',
  },
  {
    href: '/calculator/b2b',
    emoji: '🏢',
    label: 'B2B',
    desc: 'Опт, НДС, скидки клиентов',
    color: 'from-violet-500 to-violet-600',
    bg: 'bg-violet-50 border-violet-200 hover:border-violet-400',
  },
]

const STATUS_COLORS: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-600',
  sent:     'bg-blue-100 text-blue-700',
  thinking: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  launched: 'bg-purple-100 text-purple-700',
  rejected: 'bg-red-100 text-red-600',
}
const STATUS_LABELS: Record<string, string> = {
  draft:    'Черновик',
  sent:     'Отправлено',
  thinking: 'Думает',
  approved: 'Согласовано',
  launched: 'Запущено',
  rejected: 'Отказ',
}
const PRODUCT_LABELS: Record<string, string> = {
  mirror: 'Зеркало', loft: 'Лофт',
  shower: 'Душевая', shower_standard: 'Душевая', shower_budget: 'Душевая',
}

const OWNER_CENTER = [
  { href: '/admin/dashboard',      emoji: '📊', label: 'Дашборд',        desc: 'Выручка, маржа, конверсия' },
  { href: '/admin/pnl',            emoji: '📈', label: 'P&L',            desc: 'Доходы, расходы, прибыль' },
  { href: '/admin/org',            emoji: '🏗️', label: 'Оргструктура',  desc: 'Роли, регламенты, KPI' },
  { href: '/admin/roadmap',        emoji: '🗺️', label: 'Roadmap',        desc: 'Прогресс внедрения' },
  { href: '/admin/infrastructure', emoji: '⚙️', label: 'Техцентр',       desc: 'ENV, инфраструктура, боты' },
  { href: '/admin/analytics-mglass', emoji: '🔍', label: 'Аналитика',   desc: 'Менеджеры, продукты, каналы' },
  { href: '/admin/users',          emoji: '👥', label: 'Пользователи',   desc: 'Доступы и роли' },
  { href: '/admin/suppliers',      emoji: '🏭', label: 'Поставщики',     desc: 'Контакты и условия' },
  { href: '/admin/warehouse',      emoji: '📦', label: 'Склад',          desc: 'Остатки и алерты' },
]

export default async function Home() {
  const role = await getRole()
  if (role === 'partner') redirect('/partner')   // партнёр видит только свой кабинет
  const isAdmin = role === 'admin'
  const supabase = await createClient()

  const now = new Date()
  const todayStr  = now.toISOString().slice(0, 10)
  const monthStr  = now.toISOString().slice(0, 7)
  const dateLabel = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`

  // Fetch B2C calc stats
  const { data: calcs } = await supabase
    .from('calculations')
    .select('id, status, final_price, margin, product_type, client_name, created_at, input_data')
    .order('created_at', { ascending: false })
    .limit(200)

  const all = calcs ?? []

  const todayCalcs   = all.filter(c => c.created_at?.slice(0, 10) === todayStr).length
  const sentCalcs    = all.filter(c => c.status === 'sent' || c.status === 'thinking').length
  const approvedMonth = all.filter(c =>
    (c.status === 'approved' || c.status === 'launched') &&
    c.created_at?.slice(0, 7) === monthStr
  ).length
  const revenueMonth = all
    .filter(c => (c.status === 'approved' || c.status === 'launched') && c.created_at?.slice(0, 7) === monthStr)
    .reduce((s, c) => s + (c.final_price ?? 0), 0)

  const recent = all.slice(0, 5)

  // Manager name (for admin only to avoid extra queries)
  let usersMap: Record<string, string> = {}
  if (isAdmin) {
    const admin = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data } = await admin.from('users').select('id,name,email')
    if (data) usersMap = Object.fromEntries(data.map(u => [u.id, u.name ?? u.email]))
  }

  return (
    <div className="max-w-[960px] mx-auto px-5 py-8 space-y-8">

      {/* Greeting */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[13px] text-[#9a9a95]">{dateLabel}</p>
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight mt-0.5">Панель менеджера</h1>
        </div>
        <Link href="/calculations"
          className="text-[13px] text-blue-600 hover:underline font-medium">
          Все расчёты →
        </Link>
      </div>

      {/* ── NEW CALCULATION – hero section ────────────────────────────── */}
      <section>
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-3">Новый расчёт</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {CALC_CARDS.map(c => (
            <Link key={c.href} href={c.href}
              className={`group border-2 rounded-2xl p-4 transition-all hover:shadow-md ${c.bg}`}>
              <div className="text-2xl mb-2">{c.emoji}</div>
              <p className="text-[15px] font-bold text-[#111110] mb-0.5">{c.label}</p>
              <p className="text-[11px] text-[#6b6b66] leading-snug">{c.desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── KPI row ────────────────────────────────────────────────────── */}
      <section>
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-3">Статистика</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Расчётов сегодня', value: todayCalcs,    href: '/calculations', accent: '' },
            { label: 'Ожидают ответа',   value: sentCalcs,     href: '/calculations', accent: sentCalcs > 0 ? 'text-amber-600' : '' },
            { label: 'Согласовано в месяце', value: approvedMonth, href: '/calculations', accent: approvedMonth > 0 ? 'text-emerald-600' : '' },
            { label: 'Выручка (согл.)',   value: revenueMonth > 0 ? fmt(revenueMonth) : '—', href: '/calculations', accent: 'text-emerald-600' },
          ].map(({ label, value, href, accent }) => (
            <Link key={label} href={href}
              className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5 hover:border-[#c4c4be] hover:shadow-sm transition-all">
              <p className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-wider mb-1.5 leading-tight">{label}</p>
              <p className={`text-[22px] font-bold tabular-nums leading-none ${accent || 'text-[#111110]'}`}>{value}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Recent calculations ────────────────────────────────────────── */}
      {recent.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider">Последние расчёты</p>
            <Link href="/calculations" className="text-[12px] text-blue-600 hover:underline">Все →</Link>
          </div>
          <div className="space-y-2">
            {recent.map(c => {
              const prodLabel = PRODUCT_LABELS[c.product_type] ?? c.product_type
              const st = STATUS_LABELS[c.status] ?? 'Черновик'
              const stColor = STATUS_COLORS[c.status] ?? STATUS_COLORS.draft
              const d = c.input_data as Record<string, unknown>
              const dim = c.product_type === 'loft' || c.product_type === 'mirror'
                ? `${d.width}×${d.height} мм`
                : d.dimStr ?? `${d.width}×${d.height} мм`
              return (
                <Link key={c.id} href={`/calculations/${c.id}`}
                  className="flex items-center gap-3 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 hover:border-[#c4c4be] hover:shadow-sm transition-all">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-[#111110]">
                        {c.client_name ?? prodLabel}
                      </span>
                      {c.client_name && (
                        <span className="text-[11px] text-[#9a9a95]">{prodLabel}</span>
                      )}
                      {dim && (
                        <span className="text-[11px] text-[#9a9a95]">{String(dim)}</span>
                      )}
                    </div>
                    <p className="text-[12px] text-[#9a9a95] mt-0.5">
                      {new Date(c.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      {isAdmin && c.created_at && ' · ' + (usersMap[(c as { created_by?: string }).created_by ?? ''] ?? '')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[14px] font-bold tabular-nums text-[#111110]">
                      {(c.final_price ?? 0).toLocaleString('ru-RU')} ₽
                    </span>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${stColor}`}>{st}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {/* ── OWNER CENTER (admin only) ─────────────────────────────────── */}
      {isAdmin && (
        <section>
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider">Owner Center</p>
            <div className="flex-1 h-px bg-[#e4e4e0]" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {OWNER_CENTER.map(item => (
              <Link key={item.href} href={item.href}
                className="flex items-start gap-3 bg-white border border-[#e4e4e0] rounded-xl p-3.5 hover:border-[#c4c4be] hover:shadow-sm transition-all group">
                <span className="text-lg leading-none mt-0.5">{item.emoji}</span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-[#111110] group-hover:text-blue-600 transition-colors">{item.label}</p>
                  <p className="text-[11px] text-[#9a9a95] leading-snug">{item.desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

    </div>
  )
}
