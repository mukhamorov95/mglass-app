import Link from 'next/link'
import { getRole } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'

const MONTH_NAMES = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']

const MGLASS_MODULES = [
  { href: '/calculator/mirror', label: 'Зеркало с подсветкой',  desc: 'Размеры, тип зеркала, LED, форма, допы, финмодель',    tag: 'Калькулятор', tagColor: 'text-blue-600 bg-blue-50' },
  { href: '/calculator/loft',   label: 'Лофт-перегородка',       desc: 'Секции, деления, стекло, покраска, фурнитура, металл',  tag: 'Калькулятор', tagColor: 'text-orange-600 bg-orange-50' },
  { href: '/calculator/shower', label: 'Душевая перегородка',    desc: 'Модель, размеры, стекло, фурнитура, монтаж, финмодель', tag: 'Калькулятор', tagColor: 'text-cyan-600 bg-cyan-50' },
  { href: '/calculations',      label: 'История расчётов',       desc: 'Все расчёты, статусы, маржа, клиентские тексты',        tag: 'Журнал',      tagColor: 'text-emerald-600 bg-emerald-50' },
  { href: '/ai-sales',          label: 'AI Sales',               desc: 'Ассистент продаж, генерация КП, ответы на вопросы клиентов', tag: 'AI',     tagColor: 'text-violet-600 bg-violet-50' },
]

const PRODUCTION_MODULES = [
  { href: '/calculator/b2b', label: 'B2B Калькулятор', desc: 'Оптовые заказы, НДС, отходы, скидки клиентов',      tag: 'Расчёт', tagColor: 'text-violet-600 bg-violet-50' },
  { href: '/b2b-quotes',     label: 'B2B Просчёты',    desc: 'Ожидают подтверждения, запуск в производство',       tag: 'Журнал', tagColor: 'text-violet-600 bg-violet-50' },
  { href: '/b2b-orders',     label: 'B2B Заказы',      desc: 'История по месяцам, этапы, сроки, суммы',            tag: 'Журнал', tagColor: 'text-violet-600 bg-violet-50' },
  { href: '/production',     label: 'Производство',    desc: 'Поиск по номеру, отметка этапов, фильтр по операциям', tag: 'Цех',  tagColor: 'text-orange-700 bg-orange-50' },
]

const ADMIN_MODULES = [
  { href: '/admin/materials',     label: 'Материалы',            desc: 'Справочник цен на зеркало, стекло, профиль, LED',  tag: 'Справочник',       tagColor: 'text-[#6b6b66] bg-[#f0f0ec]' },
  { href: '/admin/services',      label: 'Услуги',               desc: 'Монтаж, доставка, закалка, покраска',              tag: 'Справочник',       tagColor: 'text-[#6b6b66] bg-[#f0f0ec]' },
  { href: '/admin/hardware',      label: 'Фурнитура',            desc: 'Ролики, треки, петли, ручки, замки',               tag: 'Справочник',       tagColor: 'text-[#6b6b66] bg-[#f0f0ec]' },
  { href: '/admin/settings',      label: 'Финансовые настройки', desc: 'Маржа, расходы, налоги, минимальный порог',        tag: 'Настройки',        tagColor: 'text-[#6b6b66] bg-[#f0f0ec]' },
  { href: '/admin/users',         label: 'Пользователи',         desc: 'Менеджеры, роли, доступ',                         tag: 'Администрирование', tagColor: 'text-purple-700 bg-purple-50' },
]

function ModuleCard({ href, label, desc, tag, tagColor }: {
  href: string; label: string; desc: string; tag: string; tagColor: string
}) {
  return (
    <Link href={href}
      className="group bg-white border border-[#e4e4e0] rounded-xl p-5 hover:border-[#c4c4be] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] transition-all">
      <div className="flex items-start justify-between mb-3">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md tracking-wide uppercase ${tagColor}`}>{tag}</span>
        <svg className="w-4 h-4 text-[#c4c4be] group-hover:text-[#8a8a85] transition-colors mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
      <h2 className="text-[15px] font-semibold text-[#111110] mb-1.5 tracking-tight">{label}</h2>
      <p className="text-[13px] text-[#8a8a85] leading-relaxed">{desc}</p>
    </Link>
  )
}

function KPICard({ label, value, href, accent }: {
  label: string; value: string | number; href: string; accent?: 'red' | 'amber' | 'emerald'
}) {
  const valueClass = accent === 'red' ? 'text-red-600' : accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-[#111110]'
  return (
    <Link href={href}
      className="bg-white border border-[#e4e4e0] rounded-xl px-4 py-3.5 hover:border-[#c4c4be] hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all">
      <p className="text-[11px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1.5">{label}</p>
      <p className={`text-[22px] font-bold tabular-nums leading-none ${valueClass}`}>{value}</p>
    </Link>
  )
}

export default async function Home() {
  const role = await getRole()
  const supabase = await createClient()

  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

  const { data: allOrders } = await supabase
    .from('b2b_orders')
    .select('id,total_after_discount,total_sale_inc_vat,discount_percent,notes,created_at')

  const orders = allOrders ?? []

  const confirmed = orders.filter(o => {
    try { const p = JSON.parse(o.notes ?? '{}'); return p.status !== 'quote' } catch { return true }
  })
  const quotes = orders.filter(o => {
    try { const p = JSON.parse(o.notes ?? '{}'); return p.status === 'quote' } catch { return false }
  })

  const activeOrders = confirmed.filter(o => {
    try { const p = JSON.parse(o.notes ?? '{}'); return !p.stages?.shipped } catch { return true }
  })

  const overdueOrders = activeOrders.filter(o => {
    try {
      const p = JSON.parse(o.notes ?? '{}')
      if (!p.launched_at || !p.production_days) return false
      const deadline = new Date(p.launched_at)
      deadline.setDate(deadline.getDate() + p.production_days)
      return deadline < now
    } catch { return false }
  })

  const monthRevenue = confirmed
    .filter(o => o.created_at >= monthStart)
    .reduce((s, o) => s + ((o.discount_percent ?? 0) > 0 ? (o.total_after_discount ?? 0) : (o.total_sale_inc_vat ?? 0)), 0)

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-8">

      {/* KPI */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <h2 className="text-[14px] font-bold text-[#111110] tracking-tight">Сейчас</h2>
          <span className="text-[12px] text-[#9a9a95]">{now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KPICard label="Заказов в работе"         value={activeOrders.length}   href="/b2b-orders" />
          <KPICard label="Просрочено"                value={overdueOrders.length}  href="/production" accent={overdueOrders.length > 0 ? 'red' : undefined} />
          <KPICard
            label={`Выручка ${MONTH_NAMES[now.getMonth()]}`}
            value={monthRevenue > 0 ? monthRevenue.toLocaleString('ru-RU') + ' ₽' : '—'}
            href="/b2b-analytics"
            accent={monthRevenue > 0 ? 'emerald' : undefined}
          />
          <KPICard label="Ожидают подтверждения"    value={quotes.length}         href="/b2b-quotes"  accent={quotes.length > 0 ? 'amber' : undefined} />
        </div>
      </section>

      {/* МГласс */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[16px] font-bold text-[#111110] tracking-tight">МГласс</h2>
          <span className="text-[12px] text-[#9a9a95]">Расчёты, калькуляторы, история</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {MGLASS_MODULES.map(m => <ModuleCard key={m.href} {...m} />)}
        </div>
      </section>

      {/* Производство */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-[16px] font-bold text-[#111110] tracking-tight">Производство</h2>
          <span className="text-[12px] text-[#9a9a95]">B2B заказы, этапы, цех</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PRODUCTION_MODULES.map(m => <ModuleCard key={m.href} {...m} />)}
        </div>
      </section>

      {/* Администрирование */}
      {role === 'admin' && (
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-[16px] font-bold text-[#111110] tracking-tight">Администрирование</h2>
            <span className="text-[12px] text-[#9a9a95]">Справочники, настройки, пользователи</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {ADMIN_MODULES.map(m => <ModuleCard key={m.href} {...m} />)}
          </div>
        </section>
      )}

    </div>
  )
}
