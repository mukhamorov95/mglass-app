'use client'

import { useState, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type TaskStatus = 'done' | 'in_progress' | 'planned'
type Phase = 0 | 1 | 2 | 3
type Tab = 'org' | 'roadmap' | 'progress'

type Task = {
  id: string
  title: string
  desc: string
  roles: string[]
  phase: Phase
  effort: string
  defaultStatus: TaskStatus
}

// ─── Org structure data ───────────────────────────────────────────────────────

const ORG = [
  {
    id: 'owner',
    title: 'Собственник',
    name: 'Владислав',
    color: 'bg-[#111110] text-white',
    accent: 'border-[#111110]',
    textColor: 'text-ink',
    level: 0,
    systemAccess: ['Дашборд собственника', 'Вся аналитика', 'Финансовые настройки', 'Технический центр', 'Telegram-бот'],
    missing: ['Дашборд в реальном времени', 'P&L отчёт', 'Алерты аномалий'],
  },
  {
    id: 'cfo',
    title: 'Финансовый директор',
    color: 'bg-violet-600 text-white',
    accent: 'border-violet-600',
    textColor: 'text-violet-700',
    level: 1,
    systemAccess: ['Финансовые настройки', 'Аналитика расчётов', 'Маржинальная модель', 'B2B аналитика'],
    missing: ['Учёт оплат', 'P&L отчёт', 'Лимиты скидок', 'Кассовые разрывы'],
  },
  {
    id: 'sales_lead',
    title: 'Руководитель продаж',
    color: 'bg-blue-600 text-white',
    accent: 'border-blue-600',
    textColor: 'text-blue-700',
    level: 1,
    systemAccess: ['Все калькуляторы', 'Аналитика менеджеров', 'Воронка AMO', 'Статистика AI-бота'],
    missing: ['SLA-таймеры', 'Конверсия по менеджерам', 'Дашборд команды'],
  },
  {
    id: 'install_lead',
    title: 'Руководитель монтажей',
    color: 'bg-orange-600 text-white',
    accent: 'border-orange-600',
    textColor: 'text-orange-700',
    level: 1,
    systemAccess: ['История заказов', 'Задачи AI в AMO'],
    missing: ['Календарь замеров', 'Управление бригадами', 'Маршруты', 'Акты выполнения'],
  },
  {
    id: 'production_lead',
    title: 'Начальник производства',
    color: 'bg-amber-600 text-white',
    accent: 'border-amber-600',
    textColor: 'text-amber-700',
    level: 1,
    systemAccess: ['Статусы заказов'],
    missing: ['Очередь заданий', 'Нормативы времени', 'Загрузка производства'],
  },
  {
    id: 'manager',
    title: 'Менеджер продаж',
    color: 'bg-blue-500 text-white',
    accent: 'border-blue-500',
    textColor: 'text-blue-600',
    level: 2,
    parent: 'sales_lead',
    systemAccess: ['Все калькуляторы', 'AI-инструменты', 'Генератор КП', 'Telegram-бот', 'Мои заработки', 'B2B'],
    missing: ['PDF КП', 'Карточка клиента', 'Follow-up напоминания', 'Быстрые шаблоны'],
  },
  {
    id: 'measurer',
    title: 'Замерщик',
    color: 'bg-orange-400 text-white',
    accent: 'border-orange-400',
    textColor: 'text-orange-600',
    level: 2,
    parent: 'install_lead',
    systemAccess: ['Просмотр заказов'],
    missing: ['Мобильная форма замера', 'Фото объекта', 'Передача размеров'],
  },
  {
    id: 'installer',
    title: 'Монтажник',
    color: 'bg-orange-300 text-white',
    accent: 'border-orange-300',
    textColor: 'text-orange-500',
    level: 2,
    parent: 'install_lead',
    systemAccess: ['Просмотр заказов'],
    missing: ['Маршрутный лист', 'Акт выполнения', 'Фото результата'],
  },
  {
    id: 'production',
    title: 'Работник производства',
    color: 'bg-amber-500 text-white',
    accent: 'border-amber-500',
    textColor: 'text-amber-600',
    level: 2,
    parent: 'production_lead',
    systemAccess: ['Статусы заказов'],
    missing: ['Производственное задание', 'Чеклист этапов', 'Фото изделия'],
  },
  {
    id: 'warehouse',
    title: 'Работник склада',
    color: 'bg-amber-400 text-white',
    accent: 'border-amber-400',
    textColor: 'text-amber-600',
    level: 2,
    parent: 'production_lead',
    systemAccess: ['Просмотр заказов'],
    missing: ['Складской учёт', 'Спецификация на заказ', 'Приёмка материалов'],
  },
  {
    id: 'buyer',
    title: 'Закупщик',
    color: 'bg-teal-600 text-white',
    accent: 'border-teal-600',
    textColor: 'text-teal-700',
    level: 1,
    systemAccess: ['Таблица материалов'],
    missing: ['Поставщики', 'Остатки', 'Алерты минимума', 'История цен'],
  },
  {
    id: 'logist',
    title: 'Логист',
    color: 'bg-emerald-600 text-white',
    accent: 'border-emerald-600',
    textColor: 'text-emerald-700',
    level: 1,
    systemAccess: ['История заказов'],
    missing: ['Раздел доставок', 'Адреса в заказах', 'Маршрутный лист', 'Зоны с ценами'],
  },
]

// ─── Roadmap tasks ────────────────────────────────────────────────────────────

const TASKS: Task[] = [
  // ── Phase 0: СДЕЛАНО ──
  { id: 'calc_mirror',    title: 'Калькулятор зеркал с LED',       desc: 'Формы, материалы, подсветка, пескоструй, маржа',                      roles: ['Менеджер', 'CFO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'calc_loft',      title: 'Калькулятор лофт-перегородок',   desc: 'Секции, типы открывания, фурнитура',                                    roles: ['Менеджер', 'CFO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'calc_shower',    title: 'Калькулятор душевых',            desc: '12 моделей, бюджет/стандарт, фурнитура',                               roles: ['Менеджер', 'CFO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'calc_history',   title: 'История расчётов',               desc: 'Сохранение, фильтры, пересчёт',                                        roles: ['Менеджер', 'CEO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'margin',         title: 'Маржинальный светофор',          desc: '🟢🟡🔴 на каждом расчёте, настройки по продукту',                      roles: ['Менеджер', 'CFO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'earnings',       title: 'Заработки менеджера',            desc: '2% базовый + бонус от сверхмаржи',                                     roles: ['Менеджер'],                  phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'ai_assistant',   title: 'AI-ассистент и инструменты',     desc: 'Ассистент, возражения, подбор продукта, анализ сделки, шаблоны',       roles: ['Менеджер'],                  phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'kp_gen',         title: 'Генератор КП (текст)',           desc: 'AI генерирует текст КП на основе расчёта',                             roles: ['Менеджер'],                  phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'tg_bot',         title: 'Telegram-бот',                   desc: 'Голосовой ввод, расчёты, управление лидами, /health',                  roles: ['Менеджер', 'Собственник'],   phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'wa_bot',         title: 'WhatsApp-бот (Wazzup)',          desc: 'AI-диалог от лица Владислава, закрытие на замер',                      roles: ['Менеджер'],                  phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'amocrm',         title: 'AmoCRM интеграция',              desc: 'Лиды, задачи, заметки, воронка',                                       roles: ['Менеджер', 'Монтажи'],       phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'b2b',            title: 'B2B модуль',                     desc: 'Отдельные прайсы, просчёты, заказы, аналитика',                        roles: ['Менеджер', 'CEO'],           phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'analytics',      title: 'Аналитика расчётов',             desc: 'По менеджерам, по продуктам, по периодам',                             roles: ['CEO', 'Собственник'],        phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'users',          title: 'Пользователи и роли',            desc: 'admin/manager, Telegram-авторизация',                                  roles: ['CEO'],                       phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'infra',          title: 'Технический центр',              desc: 'Карта инфраструктуры, ENV, диагностика, инструкции',                   roles: ['Собственник'],               phase: 0, effort: '—', defaultStatus: 'done' },
  { id: 'orders',         title: 'Заказы с статусами',             desc: 'Создание, статусы, история, фильтры',                                  roles: ['Менеджер', 'CEO'],           phase: 0, effort: '—', defaultStatus: 'done' },

  // ── Phase 1: КРИТИЧНО ──
  { id: 'backup',         title: 'Автобекап базы данных',          desc: 'Supabase Pro или scheduled export. Риск потери всех данных',           roles: ['Собственник'],               phase: 1, effort: '1 день',   defaultStatus: 'done' },
  { id: 'uptime',         title: 'Uptime мониторинг',              desc: 'UptimeRobot — SMS/Telegram при падении сайта или бота',               roles: ['Собственник', 'CEO'],        phase: 1, effort: '1 день',   defaultStatus: 'planned' },
  { id: 'pdf_kp',         title: 'PDF КП с брендингом',            desc: 'Красивый документ с логотипом, фото, ценой, QR на замер',             roles: ['Менеджер'],                  phase: 1, effort: '3 дня',   defaultStatus: 'done' },
  { id: 'followup',       title: 'Follow-up напоминания по КП',    desc: 'Автоматически через 3 дня после КП: напоминание клиенту',             roles: ['Менеджер'],                  phase: 1, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'payments',       title: 'Учёт оплат на заказах',          desc: 'Предоплата, остаток, статус оплаты, дебиторка',                        roles: ['CFO', 'Менеджер'],           phase: 1, effort: '3 дня',   defaultStatus: 'done' },
  { id: 'discount_limit', title: 'Лимиты скидок с согласованием',  desc: 'До X% — сам, выше — запрос руководителю прямо в системе',            roles: ['CFO', 'Менеджер'],           phase: 1, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'owner_dash',     title: 'Дашборд собственника',           desc: 'Выручка/маржа/заказов/тренды — один экран, всё видно',               roles: ['Собственник'],               phase: 1, effort: '4 дня',   defaultStatus: 'done' },

  // ── Phase 2: ВАЖНО ──
  { id: 'prod_task',      title: 'Производственное задание',       desc: 'Карточка с размерами, параметрами, сроком. Этапы + чекбоксы',         roles: ['Производство'],              phase: 2, effort: '1 неделя', defaultStatus: 'done' },
  { id: 'prod_photo',     title: 'Фото готового изделия',          desc: 'Загрузка фото при завершении — контроль качества, защита от споров',  roles: ['Производство', 'Монтажи'],   phase: 2, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'mount_calendar', title: 'Календарь замеров и монтажей',   desc: 'Визуальный календарь: замер/монтаж, адрес, монтажник, статус',        roles: ['Монтажи'],                   phase: 2, effort: '1 неделя', defaultStatus: 'done' },
  { id: 'client_card',    title: 'Карточка клиента с историей',    desc: 'Все расчёты, заказы, КП, история — в одном месте',                   roles: ['Менеджер'],                  phase: 2, effort: '4 дня',   defaultStatus: 'done' },
  { id: 'warehouse',      title: 'Склад: остатки и алерты',        desc: 'Учёт остатков материалов + уведомление при дефиците',                roles: ['Склад', 'Закупщик'],         phase: 2, effort: '1 неделя', defaultStatus: 'done' },
  { id: 'sla',            title: 'SLA-таймеры на заказах',         desc: 'Заказ завис в статусе > N дней — алерт руководителю',               roles: ['CEO'],                       phase: 2, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'measurer_app',   title: 'Мобильная форма замерщика',      desc: 'Замерщик вводит размеры на объекте → сразу в систему + фото',        roles: ['Монтажи'],                   phase: 2, effort: '4 дня',   defaultStatus: 'done' },
  { id: 'delivery_addr',  title: 'Адрес доставки в заказах',       desc: 'Обязательное поле + автоуведомление логисту при готовности',         roles: ['Логист'],                    phase: 2, effort: '1 день',   defaultStatus: 'done' },
  { id: 'owner_alerts',   title: 'Алерты аномалий собственнику',   desc: 'Скидка > X%, маржа < минимума → Telegram собственнику',             roles: ['Собственник', 'CFO'],        phase: 2, effort: '2 дня',   defaultStatus: 'done' },

  // ── Phase 3: ПЛАНОВО ──
  { id: 'suppliers',      title: 'Справочник поставщиков',         desc: 'Поставщик → материалы, контакт, условия, история цен',               roles: ['Закупщик'],                  phase: 3, effort: '3 дня',   defaultStatus: 'done' },
  { id: 'brigades',       title: 'Справочник бригад / монтажников', desc: 'ФИО, специализация, загрузка, назначение на заказ',                 roles: ['Монтажи'],                   phase: 3, effort: '3 дня',   defaultStatus: 'done' },
  { id: 'route_sheet',    title: 'Маршрутный лист доставок',       desc: 'Экспорт списка доставок на день: адреса, контакты, изделия',         roles: ['Логист'],                    phase: 3, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'delivery_zones', title: 'Зоны доставки с ценами',         desc: 'В пределах МКАД / 10 / 30 / 30+ км — автоцена в калькуляторе',      roles: ['Логист', 'CFO'],             phase: 3, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'pnl',            title: 'P&L финансовый отчёт',           desc: 'Выручка / себестоимость / маржа / расходы по месяцам',               roles: ['CFO', 'Собственник'],        phase: 3, effort: '1 неделя', defaultStatus: 'done' },
  { id: 'act',            title: 'Акт выполненных работ',          desc: 'Цифровой акт с подписью / кодом клиента',                            roles: ['Монтажи'],                   phase: 3, effort: '3 дня',   defaultStatus: 'done' },
  { id: 'rating',         title: 'Рейтинг монтажников',            desc: 'Клиент оценивает монтаж 1-5. Статистика по бригадам',               roles: ['Монтажи', 'CEO'],            phase: 3, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'sentry',         title: 'Error tracking (Sentry)',         desc: 'Все ошибки кода с трейсами — без Vercel Logs',                       roles: ['Собственник'],               phase: 3, effort: '1 день',   defaultStatus: 'done' },
  { id: 'domain',         title: 'Кастомный домен',                 desc: 'mglass.ru или mglass.pro вместо vercel.app',                         roles: ['Собственник'],               phase: 3, effort: '1 день',   defaultStatus: 'planned' },
  { id: 'warehouse_spec', title: 'Спецификация на заказ для склада', desc: 'Список материалов для комплектации конкретного заказа',            roles: ['Склад'],                     phase: 3, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'notify_client',  title: 'Уведомления клиенту по этапам',  desc: 'WhatsApp: заказ принят / в производстве / готов / едем монтировать', roles: ['Менеджер', 'Монтажи'],       phase: 3, effort: '2 дня',   defaultStatus: 'done' },
  { id: 'org_structure',  title: 'Оргструктура и регламенты ролей', desc: '17 ролей с KPI, чеклистами, функциями, регламентами и PDF-выгрузкой', roles: ['Собственник', 'CEO'],        phase: 3, effort: '2 дня',   defaultStatus: 'done' },
]

const ROLE_COLORS: Record<string, string> = {
  'Собственник':   'bg-[#111110] text-white',
  'CFO':           'bg-violet-100 text-violet-700',
  'CEO':           'bg-purple-100 text-purple-700',
  'Менеджер':      'bg-blue-100 text-blue-700',
  'Монтажи':       'bg-orange-100 text-orange-700',
  'Производство':  'bg-amber-100 text-amber-700',
  'Склад':         'bg-yellow-100 text-yellow-700',
  'Закупщик':      'bg-teal-100 text-teal-700',
  'Логист':        'bg-emerald-100 text-emerald-700',
}

const PHASE_META = [
  { phase: 0, label: 'Уже сделано',   color: 'bg-emerald-50 border-emerald-200', badge: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  { phase: 1, label: 'Фаза 1 — Критично', color: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-700',         dot: 'bg-red-500' },
  { phase: 2, label: 'Фаза 2 — Важно',    color: 'bg-amber-50 border-amber-200',badge: 'bg-amber-100 text-amber-700',     dot: 'bg-amber-500' },
  { phase: 3, label: 'Фаза 3 — Планово',  color: 'bg-blue-50 border-blue-200',  badge: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-400' },
]

// ─── OrgChart ─────────────────────────────────────────────────────────────────

function OrgCard({ person, expanded, onToggle }: {
  person: typeof ORG[0]
  expanded: boolean
  onToggle: () => void
}) {
  const done = person.systemAccess.length
  const missing = person.missing.length
  return (
    <div className={`border-2 rounded-xl overflow-hidden transition-shadow hover:shadow-md ${person.accent} bg-surface`} style={{ minWidth: 200 }}>
      <button onClick={onToggle} className="w-full text-left">
        <div className={`px-4 py-3 ${person.color}`}>
          <p className="text-[13px] font-semibold">{person.title}</p>
          {'name' in person && <p className="text-[11px] opacity-70 mt-0.5">{(person as any).name}</p>}
        </div>
        <div className="px-4 py-2 flex items-center justify-between">
          <div className="flex gap-2">
            <span className="text-[11px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-semibold">✓ {done}</span>
            <span className="text-[11px] bg-red-50 text-red-600 px-2 py-0.5 rounded-full font-semibold">! {missing}</span>
          </div>
          <svg className={`w-3.5 h-3.5 text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-line-soft">
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider mt-3 mb-1.5">В системе есть</p>
          {person.systemAccess.map((a, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px] text-ink-soft mb-1">
              <span className="text-emerald-500 flex-shrink-0">✓</span>{a}
            </div>
          ))}
          <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wider mt-3 mb-1.5">Нужно добавить</p>
          {person.missing.map((m, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[12px] text-ink-soft mb-1">
              <span className="text-red-400 flex-shrink-0">—</span>{m}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OrgTab() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const owner      = ORG.find(r => r.id === 'owner')!
  const level1     = ORG.filter(r => r.level === 1)
  const level2     = ORG.filter(r => r.level === 2)

  const totalDone    = ORG.reduce((s, r) => s + r.systemAccess.length, 0)
  const totalMissing = ORG.reduce((s, r) => s + r.missing.length, 0)

  return (
    <div className="space-y-8">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-line rounded-xl p-4 text-center">
          <p className="text-[28px] font-semibold text-ink">{ORG.length}</p>
          <p className="text-[12px] text-muted mt-0.5">ролей в оргструктуре</p>
        </div>
        <div className="bg-surface border border-line rounded-xl p-4 text-center">
          <p className="text-[28px] font-semibold text-emerald-600">{totalDone}</p>
          <p className="text-[12px] text-muted mt-0.5">функций уже работает</p>
        </div>
        <div className="bg-surface border border-line rounded-xl p-4 text-center">
          <p className="text-[28px] font-semibold text-red-500">{totalMissing}</p>
          <p className="text-[12px] text-muted mt-0.5">функций нужно добавить</p>
        </div>
      </div>

      {/* Org tree */}
      <div>
        <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-4">
          Нажми на карточку — увидишь что есть и чего не хватает для этой роли
        </p>

        {/* Level 0: Owner */}
        <div className="flex justify-center mb-4">
          <div className="w-64">
            <OrgCard person={owner} expanded={expanded.has(owner.id)} onToggle={() => toggle(owner.id)} />
          </div>
        </div>

        {/* Connector */}
        <div className="flex justify-center mb-0">
          <div className="w-px h-6 bg-line" />
        </div>
        <div className="flex justify-center mb-4">
          <div className="h-px bg-line" style={{ width: '90%' }} />
        </div>

        {/* Level 1 */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-2">
          {level1.map(r => (
            <div key={r.id} className="flex flex-col items-center">
              <div className="w-px h-4 bg-line mb-1" />
              <OrgCard person={r} expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} />
            </div>
          ))}
        </div>

        {/* Level 2 */}
        <div className="mt-6">
          <div className="flex justify-center mb-1">
            <div className="w-px h-4 bg-line" />
          </div>
          <div className="flex justify-center mb-4">
            <div className="h-px bg-line" style={{ width: '70%' }} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {level2.map(r => (
              <div key={r.id} className="flex flex-col items-center">
                <div className="w-px h-4 bg-line mb-1" />
                <OrgCard person={r} expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="bg-canvas border border-line rounded-xl p-4">
        <p className="text-[12px] font-semibold text-ink mb-2">Легенда</p>
        <div className="flex flex-wrap gap-4">
          <div className="flex items-center gap-2 text-[12px] text-ink-soft">
            <span className="w-4 h-4 bg-emerald-50 border-2 border-emerald-500 rounded" />
            Цифра — сколько функций системы уже доступно этой роли
          </div>
          <div className="flex items-center gap-2 text-[12px] text-ink-soft">
            <span className="w-4 h-4 bg-red-50 border-2 border-red-500 rounded" />
            Цифра — сколько функций нужно добавить
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Roadmap tab ──────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<TaskStatus, string> = {
  done:        '✅ Готово',
  in_progress: '🔄 В работе',
  planned:     '📋 Запланировано',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  done:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  planned:     'bg-gray-50 text-gray-500 border-gray-200',
}

function RoadmapTab() {
  const STORAGE_KEY = 'mglass_roadmap_statuses'
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({})
  const [filterRole, setFilterRole] = useState<string>('all')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setStatuses(JSON.parse(saved))
    } catch {}
  }, [])

  function setStatus(id: string, status: TaskStatus) {
    const next = { ...statuses, [id]: status }
    setStatuses(next)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
  }

  function getStatus(task: Task): TaskStatus {
    return statuses[task.id] ?? task.defaultStatus
  }

  const allRoles = Array.from(new Set(TASKS.flatMap(t => t.roles))).sort()
  const filtered = filterRole === 'all' ? TASKS : TASKS.filter(t => t.roles.includes(filterRole))

  const doneCount     = TASKS.filter(t => getStatus(t) === 'done').length
  const progressCount = TASKS.filter(t => getStatus(t) === 'in_progress').length
  const totalCount    = TASKS.length
  const pct = Math.round((doneCount / totalCount) * 100)

  return (
    <div className="space-y-6">
      {/* Progress bar */}
      <div className="bg-surface border border-line rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-[14px] font-semibold text-ink">Общий прогресс внедрения</p>
            <p className="text-[12px] text-muted mt-0.5">{doneCount} из {totalCount} задач выполнено{progressCount > 0 ? `, ${progressCount} в работе` : ''}</p>
          </div>
          <p className="text-[28px] font-semibold text-ink">{pct}%</p>
        </div>
        <div className="h-3 bg-line-soft rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-4 mt-3">
          {PHASE_META.slice(1).map(p => {
            const tasks = TASKS.filter(t => t.phase === p.phase)
            const done  = tasks.filter(t => getStatus(t) === 'done').length
            return (
              <div key={p.phase} className="text-center">
                <p className="text-[11px] font-semibold text-ink-soft">{p.label.split(' — ')[1]}</p>
                <p className="text-[12px] font-semibold text-ink mt-0.5">{done}/{tasks.length}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Filter by role */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterRole('all')}
          className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filterRole === 'all' ? 'bg-ink text-white' : 'bg-line-soft text-ink-soft hover:bg-line'}`}>
          Все роли
        </button>
        {allRoles.map(role => (
          <button key={role}
            onClick={() => setFilterRole(role)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${filterRole === role ? 'bg-ink text-white' : 'bg-line-soft text-ink-soft hover:bg-line'}`}>
            {role}
          </button>
        ))}
      </div>

      {/* Tasks by phase */}
      {PHASE_META.map(({ phase, label, color, badge, dot }) => {
        const tasks = filtered.filter(t => t.phase === phase)
        if (!tasks.length) return null
        const phaseDone = tasks.filter(t => getStatus(t) === 'done').length
        return (
          <div key={phase} className={`border rounded-xl overflow-hidden ${color}`}>
            <div className="px-5 py-3 flex items-center justify-between border-b border-current border-opacity-20">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                <p className="text-[13px] font-semibold text-ink">{label}</p>
              </div>
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${badge}`}>
                {phaseDone}/{tasks.length} готово
              </span>
            </div>
            <div className="divide-y divide-white/50">
              {tasks.map(task => {
                const status = getStatus(task)
                return (
                  <div key={task.id} className={`px-5 py-3.5 flex items-start gap-4 bg-white/60 hover:bg-white/80 transition-colors ${status === 'done' ? 'opacity-70' : ''}`}>
                    {/* Status selector */}
                    <select
                      value={status}
                      onChange={e => setStatus(task.id, e.target.value as TaskStatus)}
                      disabled={phase === 0}
                      className={`text-[11px] border rounded-lg px-2 py-1 font-medium flex-shrink-0 cursor-pointer disabled:cursor-default ${STATUS_COLORS[status]}`}>
                      {Object.entries(STATUS_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        <p className={`text-[13px] font-semibold text-ink ${status === 'done' ? 'line-through text-muted' : ''}`}>
                          {task.title}
                        </p>
                        {task.effort !== '—' && (
                          <span className="text-[11px] bg-surface border border-line text-muted px-1.5 py-0.5 rounded font-medium flex-shrink-0">
                            ~{task.effort}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-ink-soft mt-0.5">{task.desc}</p>
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        {task.roles.map(role => (
                          <span key={role} className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>
                            {role}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Progress tab ─────────────────────────────────────────────────────────────

function ProgressTab() {
  const STORAGE_KEY = 'mglass_roadmap_statuses'
  const [statuses, setStatuses] = useState<Record<string, TaskStatus>>({})

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) setStatuses(JSON.parse(saved))
    } catch {}
  }, [])

  function getStatus(task: Task): TaskStatus {
    return statuses[task.id] ?? task.defaultStatus
  }

  const byRole = Object.keys(ROLE_COLORS).map(role => {
    const tasks   = TASKS.filter(t => t.roles.includes(role))
    const done    = tasks.filter(t => getStatus(t) === 'done').length
    const active  = tasks.filter(t => getStatus(t) === 'in_progress').length
    const pending = tasks.filter(t => getStatus(t) === 'planned').length
    return { role, total: tasks.length, done, active, pending }
  }).filter(r => r.total > 0)

  return (
    <div className="space-y-6">
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-canvas border-b border-line">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">Прогресс по ролям</p>
        </div>
        <div className="divide-y divide-line-soft">
          {byRole.map(r => {
            const pct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0
            return (
              <div key={r.role} className="px-5 py-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[12px] px-2.5 py-1 rounded-full font-semibold ${ROLE_COLORS[r.role] ?? 'bg-gray-100 text-gray-700'}`}>
                    {r.role}
                  </span>
                  <div className="flex items-center gap-3 text-[12px] text-muted">
                    <span className="text-emerald-600 font-semibold">{r.done} готово</span>
                    {r.active > 0 && <span className="text-blue-600 font-semibold">{r.active} в работе</span>}
                    <span>{r.pending} ожидает</span>
                    <span className="font-semibold text-ink w-10 text-right">{pct}%</span>
                  </div>
                </div>
                <div className="h-2 bg-line-soft rounded-full overflow-hidden">
                  <div className="h-full flex">
                    <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                    {r.active > 0 && (
                      <div className="h-full bg-blue-300 transition-all" style={{ width: `${Math.round((r.active / r.total) * 100)}%` }} />
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Next actions */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        <div className="px-5 py-3 bg-canvas border-b border-line">
          <p className="text-[12px] font-semibold text-muted uppercase tracking-wider">Следующие 7 задач для запуска</p>
        </div>
        <div className="divide-y divide-line-soft">
          {TASKS.filter(t => (statuses[t.id] ?? t.defaultStatus) === 'planned' && t.phase > 0)
            .slice(0, 7)
            .map((task, i) => {
              const meta = PHASE_META.find(p => p.phase === task.phase)!
              return (
                <div key={task.id} className="px-5 py-3.5 flex items-center gap-4">
                  <span className="text-[13px] font-semibold text-faint w-5 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-ink">{task.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded font-semibold ${meta.badge}`}>{meta.label.split(' — ')[1]}</span>
                      <span className="text-[11px] text-muted">~{task.effort}</span>
                      {task.roles.slice(0, 2).map(role => (
                        <span key={role} className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600'}`}>{role}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const [tab, setTab] = useState<Tab>('roadmap')

  const tabs: { id: Tab; label: string }[] = [
    { id: 'roadmap',  label: '✅ Чек-лист внедрения' },
    { id: 'org',      label: '🏢 Оргструктура' },
    { id: 'progress', label: '📊 Прогресс по ролям' },
  ]

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-ink">Дорожная карта MGlass</h1>
        <p className="text-[13px] text-muted mt-0.5">Оргструктура, план внедрения и прогресс по каждой роли</p>
      </div>

      <div className="flex gap-1 mb-6 bg-line-soft rounded-xl p-1">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 px-4 py-2 rounded-lg text-[13px] font-medium transition-all ${
              tab === t.id ? 'bg-surface text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roadmap'  && <RoadmapTab />}
      {tab === 'org'      && <OrgTab />}
      {tab === 'progress' && <ProgressTab />}
    </div>
  )
}
