import { redirect } from 'next/navigation'
import { getRole, isOwnerRole } from '@/lib/getRole'
import Link from 'next/link'

const SECTIONS = [
  {
    title: 'Стратегия и финансы',
    color: 'border-purple-200',
    items: [
      { href: '/admin/dashboard',        emoji: '📊', label: 'Дашборд собственника', desc: 'Выручка, маржа, тренды в реальном времени' },
      { href: '/admin/pnl',              emoji: '📈', label: 'P&L отчёт',            desc: 'Доходы, расходы, маржинальность по месяцам' },
      { href: '/admin/analytics-mglass', emoji: '🔍', label: 'Аналитика MGlass',    desc: 'Воронка, конверсия, KPI менеджеров' },
      { href: '/admin/settings',         emoji: '⚙️', label: 'Финансовые настройки', desc: 'Маржа, лимиты скидок, SLA, налоги' },
      { href: '/admin/pricing-manual',      emoji: '📖', label: 'Pricing Manual',          desc: 'Формулы, экономика, коридоры маржи, чеклист' },
      { href: '/admin/owner-questionnaire', emoji: '🎯', label: 'Стратегический опросник', desc: 'Целевая маржа, сроки, позиционирование, приоритеты' },
    ],
  },
  {
    title: 'Продажи и AI',
    color: 'border-rose-200',
    items: [
      { href: '/admin/bonus-center', emoji: '🎁', label: 'Bonus Center', desc: 'Бонусы для AI-менеджера: замер, доставка, upgrade' },
      { href: '/admin/sales-center', emoji: '📣', label: 'Sales Center', desc: 'Скрипты, обратная связь, инсайты по продажам' },
      { href: '/admin/avito-funnel', emoji: '📈', label: 'Воронка Avito', desc: 'Конверсия живого бота «Иван»: лиды, квалификация, скоринг' },
    ],
  },
  {
    title: 'Команда и процессы',
    color: 'border-blue-200',
    items: [
      { href: '/admin/org',     emoji: '🏗️', label: 'Оргструктура',     desc: '17 ролей, регламенты, KPI, функции, PDF' },
      { href: '/admin/roadmap', emoji: '🗺️', label: 'Roadmap',           desc: 'Чек-лист внедрения, прогресс по фазам' },
      { href: '/admin/owner-tasks', emoji: '📋', label: 'Задачи владельца', desc: 'Очередь из Telegram-бота + статус воркера' },
      { href: '/admin/users',   emoji: '👥', label: 'Пользователи',      desc: 'Менеджеры, роли, доступ к платформе' },
    ],
  },
  {
    title: 'Операции',
    color: 'border-orange-200',
    items: [
      { href: '/admin/b2b-flow',      emoji: '🔄', label: 'B2B-поток',     desc: 'Интейк vs отгрузка, пропускная способность цеха' },
      { href: '/admin/suppliers',     emoji: '🏭', label: 'Поставщики',    desc: 'База поставщиков, контакты, условия' },
      { href: '/admin/brigades',      emoji: '👷', label: 'Бригады',       desc: 'Монтажные бригады, рейтинги, специализация' },
      { href: '/admin/delivery-zones',emoji: '🚗', label: 'Зоны доставки', desc: 'Тарифы: в МКАД, до 10 км, 30+ км' },
      { href: '/admin/warehouse',     emoji: '📦', label: 'Склад',         desc: 'Остатки материалов, алерты дефицита' },
      { href: '/admin/route-sheet',   emoji: '🚚', label: 'Маршрутный лист', desc: 'Список доставок на сегодня — PDF' },
    ],
  },
  {
    title: 'Справочники',
    color: 'border-slate-200',
    items: [
      { href: '/admin/materials',      emoji: '🔩', label: 'Материалы',    desc: 'Цены на стекло, зеркало, LED, профиль' },
      { href: '/admin/services',       emoji: '🛠️', label: 'Услуги',       desc: 'Монтаж, доставка, закалка, покраска' },
      { href: '/admin/hardware',       emoji: '🪛',  label: 'Фурнитура лофт', desc: 'Ролики, треки, петли, ручки' },
      { href: '/admin/shower-hardware',emoji: '🚿', label: 'Фурнитура душевые', desc: 'Каталог с ценами по поставщикам' },
      { href: '/admin/b2b-clients',    emoji: '🏢', label: 'B2B клиенты',  desc: 'Оптовики, скидки, история' },
      { href: '/admin/b2b-materials',  emoji: '📋', label: 'B2B материалы',desc: 'Прайс для B2B-расчётов' },
      { href: '/admin/b2b-services',   emoji: '➕', label: 'B2B доп-услуги', desc: 'Пескоструй, макет, триплекс — цена и себестоимость' },
      { href: '/admin/b2b-surcharges', emoji: '📐', label: 'Надбавки за габариты', desc: 'Ступени высота/ширина/сложность → % к цене' },
    ],
  },
  {
    title: 'Технологии',
    color: 'border-emerald-200',
    items: [
      { href: '/admin/infrastructure', emoji: '🖥️', label: 'Техцентр',     desc: 'ENV, сервисы, диагностика, боты' },
      { href: '/vladislav',            emoji: '🤖', label: 'AI-центр',      desc: 'Диалоги, настройки, обучение бота' },
      { href: '/ai-stats',             emoji: '📊', label: 'Статистика AI', desc: 'Активность, качество, конверсия' },
    ],
  },
]

export default async function OwnerCenterPage() {
  const role = await getRole()
  if (!isOwnerRole(role)) redirect('/')

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">

      {/* Header */}
      <div className="mb-8">
        <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-1">Только для владельца</p>
        <h1 className="text-[24px] font-bold text-[#111110] tracking-tight">Owner Center</h1>
        <p className="text-[14px] text-[#6b6b66] mt-1">Полный доступ к управлению платформой MGlass</p>
      </div>

      {/* Sections */}
      <div className="space-y-8">
        {SECTIONS.map(section => (
          <div key={section.title}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-[13px] font-bold text-[#111110]">{section.title}</h2>
              <div className="flex-1 h-px bg-[#e4e4e0]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {section.items.map(item => (
                <Link key={item.href} href={item.href}
                  className={`flex items-start gap-3 bg-white border-2 ${section.color} rounded-xl p-4 hover:shadow-md hover:border-opacity-60 transition-all group`}>
                  <span className="text-xl mt-0.5 flex-shrink-0">{item.emoji}</span>
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#111110] group-hover:text-blue-600 transition-colors leading-tight">
                      {item.label}
                    </p>
                    <p className="text-[12px] text-[#6b6b66] mt-0.5 leading-snug">{item.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
