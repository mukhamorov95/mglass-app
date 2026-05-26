'use client'

import Link from 'next/link'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'

// ── Types ─────────────────────────────────────────────────────────────────────

type CheckStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error'
type FixStatus   = 'idle' | 'fixing' | 'fixed' | 'failed'
type Severity    = 'critical' | 'high' | 'medium' | 'low'

type CheckResult = {
  id: string
  module: string
  name: string
  status: CheckStatus
  detail?: string
  hint?: string
  ms?: number
}

type IssueMeta = {
  severity: Severity
  cause: string
  impact: string
  recommendation: string
  autoFixId?: string
  instruction?: {
    where: string
    fields: string
    data: string
    who: string
    verify: string
  }
}

type FixLogEntry = {
  id: string
  ts: string
  userEmail: string
  checkName: string
  action: string
  result: 'success' | 'fail'
  before: string
  after: string
}

// ── Display maps ──────────────────────────────────────────────────────────────

const STATUS_ICON: Record<CheckStatus, string> = {
  pending: '○', running: '◌', ok: '✓', warn: '⚠', error: '✕',
}
const STATUS_COLOR: Record<CheckStatus, string> = {
  pending: 'text-[#b0b0ac]',
  running: 'text-blue-500',
  ok:      'text-emerald-600',
  warn:    'text-amber-500',
  error:   'text-red-500',
}
const STATUS_BG: Record<CheckStatus, string> = {
  pending: 'bg-[#f4f3f1]',
  running: 'bg-blue-50',
  ok:      'bg-emerald-50',
  warn:    'bg-amber-50',
  error:   'bg-red-50',
}

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Критично', high: 'Высокий', medium: 'Средний', low: 'Низкий',
}
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high:     'bg-orange-100 text-orange-700 border border-orange-200',
  medium:   'bg-amber-100 text-amber-700 border border-amber-200',
  low:      'bg-blue-100 text-blue-700 border border-blue-200',
}

const FIX_ACTION_LABEL: Record<string, string> = {
  sync_b2b_materials:  'Синхронизация b2b_materials из glass_price_matrix',
  sync_b2b_from_glass: 'Деактивация устаревших позиций b2b_materials (нет в glass_price_matrix)',
  fix_roles_null:      'Назначение роли manager пользователям без роли',
}

const LOG_KEY = 'mglass_health_fix_log'

// ── Issue metadata ────────────────────────────────────────────────────────────

const ISSUE_META: Record<string, IssueMeta> = {
  db_calcs: {
    severity: 'critical',
    cause: 'Таблица calculations недоступна или не существует в Supabase',
    impact: 'Расчёты не сохраняются, история расчётов недоступна',
    recommendation: 'Проверьте подключение к Supabase и наличие таблицы',
    instruction: {
      where: 'Supabase → Table Editor → calculations',
      fields: 'id, created_at, final_price, cost_price, margin',
      data: 'Схема таблицы из файлов миграций проекта',
      who: 'Владислав / разработчик',
      verify: 'Повторная проверка показывает OK и кол-во записей',
    },
  },
  db_orders: {
    severity: 'critical',
    cause: 'Таблица orders недоступна или RLS-политика блокирует доступ',
    impact: 'Заказы не читаются и не сохраняются',
    recommendation: 'Проверьте Supabase и RLS-политики таблицы orders',
    instruction: {
      where: 'Supabase → Table Editor → orders',
      fields: 'id, status, created_at',
      data: 'Схема из миграций проекта',
      who: 'Владислав / разработчик',
      verify: 'Проверка показывает OK с количеством заказов',
    },
  },
  db_glass: {
    severity: 'critical',
    cause: 'Матрица цен на стекло/зеркала пуста — нет ни одной записи',
    impact: 'Все калькуляторы не могут рассчитать стоимость материала',
    recommendation: 'Добавьте цены на стекло и зеркала в /admin/glass-prices',
    instruction: {
      where: '/admin/glass-prices',
      fields: 'Название, категория (mirror/glass), тип цены (cost/sell), цена за м²',
      data: 'Прайс-лист от поставщика стекла',
      who: 'Владислав / байер',
      verify: 'Открыть любой калькулятор — материалы появились в списке',
    },
  },
  db_b2b_mat: {
    severity: 'high',
    cause: 'Таблица b2b_materials пуста — нет ни одного B2B материала',
    impact: 'B2B калькулятор не может выбрать материал для просчёта',
    recommendation: 'Синхронизировать b2b_materials из glass_price_matrix',
    autoFixId: 'sync_b2b_materials',
  },
  db_users: {
    severity: 'critical',
    cause: 'Таблица users недоступна или RLS-политика блокирует доступ',
    impact: 'Авторизация и роли пользователей не работают',
    recommendation: 'Проверьте Supabase и RLS-политики таблицы users',
    instruction: {
      where: 'Supabase → Table Editor → users',
      fields: 'id, email, role',
      data: 'Схема из миграций',
      who: 'Владислав / разработчик',
      verify: 'Выйти и войти снова — система определяет роль',
    },
  },
  db_settings: {
    severity: 'critical',
    cause: 'Таблица financial_settings пуста или недоступна',
    impact: 'Расчёт маржи и себестоимости работает без корректных настроек',
    recommendation: 'Заполните финансовые настройки в разделе Владельца',
    instruction: {
      where: '/admin/owner → раздел финансовых настроек',
      fields: 'target_margin, overhead_cost, vat_rate и другие параметры',
      data: 'Нормативы маржинальности и затрат бизнеса',
      who: 'Владислав / CEO',
      verify: 'Повторная проверка показывает "1+ записей"',
    },
  },
  db_services: {
    severity: 'high',
    cause: 'Нет активных услуг (монтаж, доставка) в справочнике',
    impact: 'Калькулятор не добавляет услуги в расчёты — клиент не видит их стоимость',
    recommendation: 'Добавьте услуги монтажа и доставки в /admin/services',
    instruction: {
      where: '/admin/services',
      fields: 'Название (содержит "монтаж" / "доставка"), цена, active = true',
      data: 'Актуальные тарифы на монтаж и доставку',
      who: 'Владислав / администратор',
      verify: 'Создать расчёт — монтаж и доставка отображаются в позициях',
    },
  },
  db_led: {
    severity: 'medium',
    cause: 'Нет активных LED-компонентов в справочнике подсветки зеркал',
    impact: 'Калькулятор зеркал не может рассчитать стоимость подсветки',
    recommendation: 'Добавьте LED-компоненты в /admin/mirror-lighting',
    instruction: {
      where: '/admin/mirror-lighting',
      fields: 'component_type (led_strip / frame / power_supply), цена, active = true',
      data: 'Прайс-лист на LED-ленту, алюминиевые каркасы, блоки питания',
      who: 'Владислав / байер',
      verify: 'Пересчитать зеркало с подсветкой — появилась стоимость LED',
    },
  },
  db_facet: {
    severity: 'low',
    cause: 'Нет активных позиций фацета в справочнике',
    impact: 'Калькулятор не может добавить фацетную обработку кромки',
    recommendation: 'Добавьте цены на фацет в /admin/facet',
    instruction: {
      where: '/admin/facet',
      fields: 'Ширина фацета, price_per_meter, active = true',
      data: 'Тарифы на шлифовку и полировку кромки',
      who: 'Владислав / байер',
      verify: 'Опция фацета появляется в калькуляторе стекла',
    },
  },
  ref_glass_names: {
    severity: 'critical',
    cause: 'Нет записей с category=mirror и price_type=cost в glass_price_matrix',
    impact: 'Калькулятор зеркал не отображает ни одного материала',
    recommendation: 'Добавьте зеркала в /admin/glass-prices → вкладка "Себестоимость"',
    instruction: {
      where: '/admin/glass-prices → Зеркала → Себестоимость',
      fields: 'Категория = mirror, тип = cost, название, цена за м²',
      data: 'Прайс-лист зеркал от поставщика',
      who: 'Владислав / байер',
      verify: 'Открыть калькулятор зеркал — появится список материалов',
    },
  },
  ref_b2b_sync: {
    severity: 'medium',
    cause: 'В b2b_materials есть активные позиции, которых нет в glass_price_matrix — устаревшие или переименованные названия',
    impact: 'B2B материалы не связаны с матрицей цен — расчёт себестоимости для таких позиций некорректен',
    recommendation: 'Деактивировать устаревшие позиции в b2b_materials (они больше не существуют в прайс-матрице)',
    autoFixId: 'sync_b2b_from_glass',
  },
  ref_led_active: {
    severity: 'high',
    cause: 'Отсутствуют некоторые типы LED-компонентов: LED-лента, каркас или блок питания',
    impact: 'Расчёт стоимости подсветки зеркал будет неполным или нулевым',
    recommendation: 'Добавьте все три типа компонентов в /admin/mirror-lighting',
    instruction: {
      where: '/admin/mirror-lighting',
      fields: 'Нужны три типа: led_strip, frame, power_supply — все с active = true',
      data: 'Цены от поставщика на каждый тип компонента',
      who: 'Владислав / байер',
      verify: 'Проверка показывает "LED, каркас, БП — есть"',
    },
  },
  ref_services: {
    severity: 'medium',
    cause: 'Не хватает обязательных услуг: монтаж и/или доставка',
    impact: 'Клиент не видит монтаж или доставку в итоговом расчёте',
    recommendation: 'Добавьте услуги «Монтаж» и «Доставка» в /admin/services',
    instruction: {
      where: '/admin/services',
      fields: 'Название содержит "монтаж" или "доставка", active = true',
      data: 'Актуальные тарифы на монтаж и доставку',
      who: 'Владислав / администратор',
      verify: 'Создать расчёт — монтаж и доставка присутствуют в позициях',
    },
  },
  calc_recent: {
    severity: 'low',
    cause: 'Нет ни одного расчёта в таблице calculations',
    impact: 'Аналитика и отчёты пусты, нет данных для анализа',
    recommendation: 'Создайте тестовый расчёт для проверки работы калькулятора',
    instruction: {
      where: '/calculator/mirror или /calculator/shower',
      fields: 'Любые тестовые параметры',
      data: 'Нужен хотя бы один расчёт',
      who: 'Любой менеджер',
      verify: 'История в /calculations не пуста',
    },
  },
  calc_has_price: {
    severity: 'medium',
    cause: 'Более 3 из 20 последних расчётов имеют нулевую итоговую цену',
    impact: 'Отчёты по выручке показывают заниженные суммы',
    recommendation: 'Проверьте формулы расчёта и наличие цен материалов',
    instruction: {
      where: '/calculations → последние записи (поле final_price)',
      fields: 'final_price должен быть > 0',
      data: 'Цены материалов в /admin/glass-prices',
      who: 'Владислав / разработчик',
      verify: 'Новые расчёты имеют final_price > 0',
    },
  },
  calc_has_margin: {
    severity: 'medium',
    cause: 'Более 2 из 20 последних расчётов имеют аномальную маржу (< 5% или > 90%)',
    impact: 'Возможны убыточные продажи, некорректная аналитика прибыли',
    recommendation: 'Проверьте настройки целевой маржи и цены себестоимости',
    instruction: {
      where: '/admin/owner → Стратегия владельца',
      fields: 'target_margin — целевая маржа в процентах',
      data: 'Нормативная маржа бизнеса MGlass (обычно 20–60%)',
      who: 'Владислав / CEO',
      verify: 'Новые расчёты имеют маржу в диапазоне 10–80%',
    },
  },
  orders_table: {
    severity: 'critical',
    cause: 'Таблица orders недоступна или возвращает ошибку',
    impact: 'Раздел заказов полностью не работает',
    recommendation: 'Проверьте Supabase и доступность таблицы orders',
    instruction: {
      where: 'Supabase → Table Editor → orders',
      fields: 'Все поля таблицы',
      data: 'Схема из файлов миграций',
      who: 'Владислав / разработчик',
      verify: 'Проверка показывает OK, раздел /orders открывается',
    },
  },
  orders_statuses: {
    severity: 'low',
    cause: 'Заказы содержат статусы не из допустимого списка системы',
    impact: 'Некорректная фильтрация и сбои в аналитике по статусам',
    recommendation: 'Обновите проблемные статусы вручную через Supabase',
    instruction: {
      where: 'Supabase → Table Editor → orders',
      fields: 'Допустимые статусы: draft, approved, in_work, done, cancelled, paused',
      data: 'Корректный статус для каждого проблемного заказа',
      who: 'Владислав / разработчик',
      verify: 'Проверка: "Статусы корректны"',
    },
  },
  b2b_quotes: {
    severity: 'critical',
    cause: 'Таблица b2b_quotes недоступна или RLS блокирует доступ',
    impact: 'B2B просчёты не сохраняются и не читаются',
    recommendation: 'Проверьте Supabase и RLS-политики таблицы b2b_quotes',
    instruction: {
      where: 'Supabase → Table Editor → b2b_quotes',
      fields: 'id, status, created_at',
      data: 'Схема из миграций',
      who: 'Владислав / разработчик',
      verify: 'Проверка показывает OK с кол-вом просчётов',
    },
  },
  b2b_materials: {
    severity: 'high',
    cause: 'Нет активных B2B материалов в таблице b2b_materials',
    impact: 'B2B калькулятор не может выбрать ни одного материала для просчёта',
    recommendation: 'Синхронизируйте b2b_materials из glass_price_matrix или добавьте вручную',
    autoFixId: 'sync_b2b_materials',
  },
  roles_users: {
    severity: 'medium',
    cause: 'Часть пользователей зарегистрирована без назначенной роли',
    impact: 'Такие пользователи не могут пользоваться системой',
    recommendation: 'Назначьте роли всем пользователям в /admin/users',
    instruction: {
      where: '/admin/users',
      fields: 'Поле role для каждого пользователя',
      data: 'Роль: admin / manager / buyer / ceo / production / seo',
      who: 'Владислав / администратор',
      verify: 'Все пользователи имеют назначенную роль',
    },
  },
  roles_no_null: {
    severity: 'high',
    cause: 'Пользователи с role = NULL — роль не назначена или сброшена',
    impact: 'Такие пользователи заблокированы или получают непредвиденные ошибки доступа',
    recommendation: 'Назначить роль manager всем пользователям без роли (уточнить позже в /admin/users)',
    autoFixId: 'fix_roles_null',
  },
  api_strategy: {
    severity: 'high',
    cause: 'API /api/admin/owner-strategy недоступен или не содержит target_margin',
    impact: 'Калькуляторы не применяют целевую маржу — расчёты могут быть убыточны',
    recommendation: 'Заполните стратегию (target_margin) в разделе Владельца',
    instruction: {
      where: '/admin/owner → раздел стратегии',
      fields: 'target_margin — целевая маржа в процентах',
      data: 'Целевой показатель маржинальности бизнеса',
      who: 'Владислав / CEO',
      verify: 'API возвращает target_margin > 0',
    },
  },
  api_pricing: {
    severity: 'high',
    cause: 'API /api/admin/pricing-formula возвращает пустой результат или недоступен',
    impact: 'Калькуляторы используют неверные или дефолтные формулы ценообразования',
    recommendation: 'Настройте формулу ценообразования в системе',
    instruction: {
      where: '/admin/pricing-formula или /admin/owner',
      fields: 'Массив параметров формулы — должен быть непустым',
      data: 'Коэффициенты и параметры формулы расчёта final_price',
      who: 'Владислав / разработчик',
      verify: 'API возвращает непустой массив параметров',
    },
  },
  api_glass: {
    severity: 'critical',
    cause: 'API /api/admin/glass-prices возвращает ошибку (не HTTP 200)',
    impact: 'Все калькуляторы не могут загрузить цены стекла — система не работает',
    recommendation: 'Проверьте route /api/admin/glass-prices и подключение к БД',
    instruction: {
      where: 'app/api/admin/glass-prices/route.ts',
      fields: 'Должен возвращать HTTP 200 и JSON-массив',
      data: 'Данные из таблицы glass_price_matrix',
      who: 'Владислав / разработчик',
      verify: 'Открыть любой калькулятор — загружает материалы без ошибки',
    },
  },
}

// ── Initial checks (unchanged) ────────────────────────────────────────────────

const INITIAL_CHECKS: Omit<CheckResult, 'status'>[] = [
  { id: 'db_calcs',         module: 'База данных',  name: 'Таблица calculations' },
  { id: 'db_orders',        module: 'База данных',  name: 'Таблица orders' },
  { id: 'db_glass',         module: 'База данных',  name: 'Таблица glass_price_matrix' },
  { id: 'db_b2b_mat',       module: 'База данных',  name: 'Таблица b2b_materials' },
  { id: 'db_users',         module: 'База данных',  name: 'Таблица users' },
  { id: 'db_settings',      module: 'База данных',  name: 'Таблица financial_settings' },
  { id: 'db_services',      module: 'База данных',  name: 'Таблица services' },
  { id: 'db_led',           module: 'База данных',  name: 'Таблица mirror_lighting_components' },
  { id: 'db_facet',         module: 'База данных',  name: 'Таблица facet_prices' },
  { id: 'ref_glass_names',  module: 'Справочники',  name: 'Есть названия стекла/зеркал' },
  { id: 'ref_b2b_sync',     module: 'Справочники',  name: 'Синхронизация glass → b2b_materials' },
  { id: 'ref_led_active',   module: 'Справочники',  name: 'Есть активные LED-компоненты' },
  { id: 'ref_services',     module: 'Справочники',  name: 'Есть активные услуги (монтаж/доставка)' },
  { id: 'calc_recent',      module: 'Расчёты',      name: 'История расчётов доступна' },
  { id: 'calc_has_price',   module: 'Расчёты',      name: 'Расчёты имеют final_price > 0' },
  { id: 'calc_has_margin',  module: 'Расчёты',      name: 'Расчёты имеют margin в диапазоне 10–80%' },
  { id: 'orders_table',     module: 'Заказы',        name: 'Заказы доступны' },
  { id: 'orders_statuses',  module: 'Заказы',        name: 'Статусы заказов корректны' },
  { id: 'b2b_quotes',       module: 'B2B',           name: 'B2B просчёты доступны' },
  { id: 'b2b_materials',    module: 'B2B',           name: 'B2B материалы с ценами' },
  { id: 'roles_users',      module: 'Роли',          name: 'У пользователей назначены роли' },
  { id: 'roles_no_null',    module: 'Роли',          name: 'Нет пользователей без роли' },
  { id: 'api_strategy',     module: 'API',           name: 'GET /api/admin/owner-strategy' },
  { id: 'api_pricing',      module: 'API',           name: 'GET /api/admin/pricing-formula' },
  { id: 'api_glass',        module: 'API',           name: 'GET /api/admin/glass-prices' },
]

// ── runChecks (unchanged logic) ───────────────────────────────────────────────

async function runChecks(
  onUpdate: (id: string, result: Partial<CheckResult>) => void,
) {
  const sb = createClient()

  async function check(
    id: string,
    fn: () => Promise<{ status: CheckStatus; detail?: string; hint?: string }>,
  ) {
    onUpdate(id, { status: 'running' })
    const t0 = Date.now()
    try {
      const res = await fn()
      onUpdate(id, { ...res, ms: Date.now() - t0 })
    } catch (e) {
      onUpdate(id, { status: 'error', detail: String(e), ms: Date.now() - t0 })
    }
  }

  await check('db_calcs', async () => {
    const { count, error } = await sb.from('calculations').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    return { status: 'ok', detail: `${count ?? 0} записей` }
  })

  await check('db_orders', async () => {
    const { count, error } = await sb.from('orders').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    return { status: 'ok', detail: `${count ?? 0} записей` }
  })

  await check('db_glass', async () => {
    const { count, error } = await sb.from('glass_price_matrix').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Таблица пустая', hint: 'Добавьте цены в /admin/glass-prices' }
    return { status: 'ok', detail: `${count} строк` }
  })

  await check('db_b2b_mat', async () => {
    const { count, error } = await sb.from('b2b_materials').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Нет материалов', hint: 'Синхронизируйте из /admin/glass-prices' }
    return { status: 'ok', detail: `${count} позиций` }
  })

  await check('db_users', async () => {
    const { count, error } = await sb.from('users').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    return { status: 'ok', detail: `${count ?? 0} пользователей` }
  })

  await check('db_settings', async () => {
    const { data, error } = await sb.from('financial_settings').select('id').limit(1)
    if (error) return { status: 'error', detail: error.message }
    if (!data?.length) return { status: 'warn', detail: 'Нет настроек', hint: 'Добавьте финансовые настройки' }
    return { status: 'ok', detail: `${data.length}+ записей` }
  })

  await check('db_services', async () => {
    const { count, error } = await sb.from('services').select('*', { count: 'exact', head: true }).eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Нет активных услуг', hint: 'Добавьте услуги в /admin/services' }
    return { status: 'ok', detail: `${count} активных` }
  })

  await check('db_led', async () => {
    const { count, error } = await sb.from('mirror_lighting_components').select('*', { count: 'exact', head: true }).eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Нет LED-компонентов', hint: 'Добавьте в /admin/mirror-lighting' }
    return { status: 'ok', detail: `${count} компонентов` }
  })

  await check('db_facet', async () => {
    const { count, error } = await sb.from('facet_prices').select('*', { count: 'exact', head: true }).eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    return { status: (count ?? 0) > 0 ? 'ok' : 'warn', detail: `${count ?? 0} позиций` }
  })

  await check('ref_glass_names', async () => {
    const { data, error } = await sb.from('glass_price_matrix').select('name').eq('price_type', 'cost').eq('category', 'mirror').limit(5)
    if (error) return { status: 'error', detail: error.message }
    if (!data?.length) return { status: 'error', detail: 'Нет записей mirror/cost', hint: 'Добавьте зеркала в /admin/glass-prices' }
    return { status: 'ok', detail: data.map(r => r.name).join(', ') }
  })

  await check('ref_b2b_sync', async () => {
    const { data: glassNames } = await sb.from('glass_price_matrix').select('name').eq('price_type', 'cost')
    const { data: b2bNames }   = await sb.from('b2b_materials').select('name').eq('active', true)
    if (!glassNames || !b2bNames) return { status: 'warn', detail: 'Не удалось проверить' }
    const gSet = new Set(glassNames.map(r => r.name))
    const missing = b2bNames.filter(r => !gSet.has(r.name)).map(r => r.name).slice(0, 3)
    if (missing.length) return { status: 'warn', detail: `Нет в матрице: ${missing.join(', ')}`, hint: 'Переименуйте или пересинхронизируйте' }
    return { status: 'ok', detail: 'Все b2b_materials есть в glass_price_matrix' }
  })

  await check('ref_led_active', async () => {
    const { data, error } = await sb.from('mirror_lighting_components').select('component_type').eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    const hasLed   = data?.some(r => r.component_type === 'led_strip')
    const hasFrame = data?.some(r => r.component_type === 'frame')
    const hasPsu   = data?.some(r => r.component_type === 'power_supply')
    if (!hasLed)   return { status: 'error', detail: 'Нет активных LED-лент', hint: 'Добавьте в /admin/mirror-lighting' }
    if (!hasFrame) return { status: 'warn',  detail: 'Нет каркасных профилей', hint: 'Добавьте каркас в /admin/mirror-lighting' }
    if (!hasPsu)   return { status: 'warn',  detail: 'Нет блоков питания' }
    return { status: 'ok', detail: 'LED, каркас, БП — есть' }
  })

  await check('ref_services', async () => {
    const { data, error } = await sb.from('services').select('name').eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    const names = (data ?? []).map(s => s.name.toLowerCase())
    const hasInstall  = names.some(n => n.includes('монтаж'))
    const hasDelivery = names.some(n => n.includes('доставка'))
    if (!hasInstall)  return { status: 'warn', detail: 'Нет услуги «Монтаж»', hint: 'Добавьте в /admin/services' }
    if (!hasDelivery) return { status: 'warn', detail: 'Нет услуги «Доставка»' }
    return { status: 'ok', detail: `${data?.length} услуг, монтаж + доставка есть` }
  })

  await check('calc_recent', async () => {
    const { data, error } = await sb.from('calculations').select('id, created_at').order('created_at', { ascending: false }).limit(5)
    if (error) return { status: 'error', detail: error.message }
    if (!data?.length) return { status: 'warn', detail: 'Нет расчётов' }
    const last = new Date(data[0].created_at).toLocaleDateString('ru-RU')
    return { status: 'ok', detail: `Последний: ${last}, всего ≥ ${data.length}` }
  })

  await check('calc_has_price', async () => {
    const { data, error } = await sb.from('calculations').select('final_price').order('created_at', { ascending: false }).limit(20)
    if (error) return { status: 'error', detail: error.message }
    const zeroPrices = (data ?? []).filter(c => !c.final_price || c.final_price <= 0)
    if (zeroPrices.length > 3) return { status: 'warn', detail: `${zeroPrices.length}/20 расчётов с нулевой ценой` }
    return { status: 'ok', detail: 'Все последние расчёты имеют цену' }
  })

  await check('calc_has_margin', async () => {
    const { data, error } = await sb.from('calculations').select('margin').order('created_at', { ascending: false }).limit(20)
    if (error) return { status: 'error', detail: error.message }
    const bad = (data ?? []).filter(c => c.margin != null && (c.margin < 5 || c.margin > 90))
    if (bad.length > 2) return { status: 'warn', detail: `${bad.length}/20 расчётов с аномальной маржой`, hint: 'Проверьте настройки маржи' }
    return { status: 'ok', detail: 'Маржа в допустимом диапазоне' }
  })

  await check('orders_table', async () => {
    const { count, error } = await sb.from('orders').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    return { status: 'ok', detail: `${count ?? 0} заказов` }
  })

  await check('orders_statuses', async () => {
    const VALID = new Set(['draft', 'approved', 'in_work', 'done', 'cancelled', 'paused'])
    const { data, error } = await sb.from('orders').select('status').limit(50)
    if (error) return { status: 'error', detail: error.message }
    const bad = (data ?? []).filter(o => o.status && !VALID.has(o.status))
    if (bad.length) return { status: 'warn', detail: `${bad.length} заказов с неизвестным статусом` }
    return { status: 'ok', detail: 'Статусы корректны' }
  })

  await check('b2b_quotes', async () => {
    const { count, error } = await sb.from('b2b_quotes').select('*', { count: 'exact', head: true })
    if (error) return { status: 'error', detail: error.message }
    return { status: 'ok', detail: `${count ?? 0} просчётов` }
  })

  await check('b2b_materials', async () => {
    const { data, error } = await sb.from('b2b_materials').select('name').eq('active', true).limit(10)
    if (error) return { status: 'error', detail: error.message }
    if (!data?.length) return { status: 'warn', detail: 'Нет активных B2B материалов' }
    return { status: 'ok', detail: `${data.length}+ активных позиций` }
  })

  await check('roles_users', async () => {
    const { data, error } = await sb.from('users').select('role').limit(20)
    if (error) return { status: 'error', detail: error.message }
    const withRole = (data ?? []).filter(u => u.role)
    return { status: 'ok', detail: `${withRole.length}/${data?.length ?? 0} с ролью` }
  })

  await check('roles_no_null', async () => {
    const { data } = await sb.from('users').select('role').is('role', null).limit(5)
    if (data?.length) return { status: 'warn', detail: `${data.length} пользователей без роли`, hint: 'Назначьте роли в /admin/users' }
    return { status: 'ok', detail: 'Все пользователи с ролями' }
  })

  await check('api_strategy', async () => {
    const r = await fetch('/api/admin/owner-strategy')
    if (!r.ok) return { status: 'error', detail: `HTTP ${r.status}` }
    const json = await r.json()
    const hasMargin = json.target_margin != null
    return { status: hasMargin ? 'ok' : 'warn', detail: hasMargin ? `target_margin=${json.target_margin}%` : 'Нет target_margin' }
  })

  await check('api_pricing', async () => {
    const r = await fetch('/api/admin/pricing-formula')
    if (!r.ok) return { status: 'error', detail: `HTTP ${r.status}` }
    const json = await r.json()
    return { status: Array.isArray(json) ? 'ok' : 'warn', detail: Array.isArray(json) ? `${json.length} параметров` : 'Неожиданный формат' }
  })

  await check('api_glass', async () => {
    const r = await fetch('/api/admin/glass-prices')
    if (!r.ok) return { status: 'error', detail: `HTTP ${r.status}` }
    return { status: 'ok', detail: `HTTP ${r.status}` }
  })
}

// ── IssueCard ─────────────────────────────────────────────────────────────────

function IssueCard({
  check,
  meta,
  fixState,
  canFix,
  onFix,
  onIgnore,
}: {
  check: CheckResult
  meta: IssueMeta
  fixState: { status: FixStatus; message?: string }
  canFix: boolean
  onFix: (checkId: string, fixId: string, checkName: string, before: string) => Promise<void>
  onIgnore: (checkId: string) => void
}) {
  const [showInstruction, setShowInstruction] = useState(false)

  const borderColor = check.status === 'error' ? 'border-red-200' : 'border-amber-200'
  const headerBg    = check.status === 'error' ? 'bg-red-50'      : 'bg-amber-50'

  return (
    <div className={`rounded-xl border overflow-hidden ${borderColor}`}>
      {/* Header */}
      <div className={`px-5 py-3 flex items-start justify-between gap-3 ${headerBg}`}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className={`text-[15px] font-bold flex-shrink-0 mt-0.5 ${STATUS_COLOR[check.status]}`}>
            {STATUS_ICON[check.status]}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[#1a1a18]">{check.name}</p>
            <p className="text-[11px] text-[#8a8a85] mt-0.5">{check.module}</p>
          </div>
        </div>
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 whitespace-nowrap ${SEVERITY_COLOR[meta.severity]}`}>
          {SEVERITY_LABEL[meta.severity]}
        </span>
      </div>

      {/* Body */}
      <div className="px-5 py-4 bg-white space-y-3">
        {check.detail && (
          <div>
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Описание</p>
            <p className={`text-[12px] ${check.status === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
              {check.detail}
            </p>
          </div>
        )}
        <div>
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Причина</p>
          <p className="text-[12px] text-[#3a3a38]">{meta.cause}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Влияние на систему</p>
          <p className="text-[12px] text-[#3a3a38]">{meta.impact}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-wide mb-1">Рекомендация</p>
          <p className="text-[12px] text-[#3a3a38]">{meta.recommendation}</p>
        </div>

        {/* Instruction panel */}
        {meta.instruction && showInstruction && (
          <div className="mt-1 rounded-lg bg-[#f7f7f4] border border-[#e8e8e5] p-4">
            <p className="text-[11px] font-semibold text-[#4a4a46] mb-3">Инструкция по исправлению</p>
            <div className="space-y-2">
              {(
                [
                  ['Где исправить',           meta.instruction.where],
                  ['Какие поля проверить',     meta.instruction.fields],
                  ['Какие данные нужны',       meta.instruction.data],
                  ['Кто должен исправить',     meta.instruction.who],
                  ['Как проверить результат',  meta.instruction.verify],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="grid grid-cols-[150px_1fr] gap-2 items-start">
                  <span className="text-[10px] text-[#8a8a85] font-medium pt-0.5">{label}</span>
                  <span className="text-[11px] text-[#2a2a28]">{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Fix result message */}
        {fixState.message && fixState.status !== 'idle' && (
          <div className={`rounded-lg px-4 py-2.5 text-[12px] font-medium ${
            fixState.status === 'fixed'  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
            fixState.status === 'failed' ? 'bg-red-50 text-red-700 border border-red-200' :
                                           'bg-blue-50 text-blue-700 border border-blue-200'
          }`}>
            {fixState.status === 'fixing' && '⟳ '}
            {fixState.status === 'fixed'  && '✓ '}
            {fixState.status === 'failed' && '✕ '}
            {fixState.message}
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-5 py-3 bg-[#fafaf8] border-t border-[#f0f0ec] flex items-center gap-2 flex-wrap">
        {/* Status badge */}
        {fixState.status === 'fixing' && (
          <span className="text-[11px] text-blue-600 font-medium">Исправляется...</span>
        )}
        {fixState.status === 'fixed' && (
          <span className="text-[11px] text-emerald-600 font-semibold">✓ Исправлено</span>
        )}
        {fixState.status === 'failed' && (
          <span className="text-[11px] text-red-600 font-semibold">✕ Не удалось исправить</span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Auto-fix button — admin/ceo only */}
          {canFix && meta.autoFixId && fixState.status !== 'fixed' && fixState.status !== 'fixing' && (
            <button
              onClick={() => onFix(check.id, meta.autoFixId!, check.name, check.detail ?? '')}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#111110] text-white hover:bg-[#27272a] active:bg-[#3f3f46] transition-colors"
            >
              Исправить автоматически
            </button>
          )}

          {/* Show instruction toggle */}
          {meta.instruction && (
            <button
              onClick={() => setShowInstruction(v => !v)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors"
            >
              {showInstruction ? 'Скрыть инструкцию' : 'Показать инструкцию'}
            </button>
          )}

          {/* Ignore */}
          {fixState.status !== 'fixed' && (
            <button
              onClick={() => onIgnore(check.id)}
              className="px-2 py-1.5 rounded-lg text-[11px] text-[#9a9a95] hover:text-[#5a5a55] transition-colors"
            >
              Игнорировать
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── FixLogSection ─────────────────────────────────────────────────────────────

function FixLogSection({ entries, onClear }: { entries: FixLogEntry[]; onClear: () => void }) {
  if (!entries.length) return null

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-[#4b4b47]">Журнал исправлений</h2>
        <button
          onClick={onClear}
          className="text-[11px] text-[#9a9a95] hover:text-[#5a5a55] transition-colors"
        >
          Очистить
        </button>
      </div>
      <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
        <div className="divide-y divide-[#f5f5f3]">
          {[...entries].reverse().map(entry => (
            <div key={entry.id} className="px-4 py-3 flex items-start gap-4">
              <div className="flex-shrink-0 w-[72px]">
                <p className="text-[10px] text-[#9a9a95]">
                  {new Date(entry.ts).toLocaleDateString('ru-RU')}
                </p>
                <p className="text-[10px] text-[#9a9a95]">
                  {new Date(entry.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] font-medium text-[#2a2a28]">{entry.checkName}</p>
                <p className="text-[11px] text-[#6a6a65] mt-0.5">{entry.action}</p>
                {entry.before && (
                  <p className="text-[10px] text-[#9a9a95] mt-0.5">Было: {entry.before}</p>
                )}
                {entry.after && (
                  <p className={`text-[11px] mt-0.5 ${entry.result === 'success' ? 'text-emerald-600' : 'text-red-600'}`}>
                    → {entry.after}
                  </p>
                )}
              </div>
              <div className="flex-shrink-0 text-right">
                <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  entry.result === 'success'
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {entry.result === 'success' ? 'Успешно' : 'Ошибка'}
                </span>
                {entry.userEmail && (
                  <p className="text-[9px] text-[#9a9a95] mt-1">{entry.userEmail.split('@')[0]}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function HealthCheckPage() {
  const [checks, setChecks] = useState<CheckResult[]>(
    INITIAL_CHECKS.map(c => ({ ...c, status: 'pending' as CheckStatus })),
  )
  const [running, setRunning]     = useState(false)
  const [done, setDone]           = useState(false)
  const [startedAt, setStartedAt] = useState<Date | null>(null)

  const [canFix, setCanFix]       = useState(false)
  const [userEmail, setUserEmail] = useState('')

  const [fixStates, setFixStates] = useState<Record<string, { status: FixStatus; message?: string }>>({})
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set())
  const [fixLog, setFixLog]       = useState<FixLogEntry[]>([])

  // Load fix log
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LOG_KEY)
      if (raw) setFixLog(JSON.parse(raw))
    } catch {}
  }, [])

  // Resolve current user role
  useEffect(() => {
    const sb = createClient()
    sb.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setUserEmail(user.email ?? '')
      sb.from('users')
        .select('role')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.role === 'admin' || data?.role === 'ceo') setCanFix(true)
        })
    })
  }, [])

  function updateCheck(id: string, partial: Partial<CheckResult>) {
    setChecks(prev => prev.map(c => c.id === id ? { ...c, ...partial } : c))
  }

  async function startCheck() {
    setChecks(INITIAL_CHECKS.map(c => ({ ...c, status: 'pending' as CheckStatus })))
    setRunning(true)
    setDone(false)
    setStartedAt(new Date())
    setFixStates({})
    setIgnoredIds(new Set())
    await runChecks(updateCheck)
    setRunning(false)
    setDone(true)
  }

  async function handleFix(checkId: string, fixId: string, checkName: string, before: string) {
    setFixStates(prev => ({
      ...prev,
      [checkId]: { status: 'fixing', message: 'Выполняется автоматическое исправление...' },
    }))
    try {
      const res  = await fetch('/api/admin/health-check/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixId }),
      })
      const json = await res.json()

      if (!res.ok || json.error) {
        const msg = json.error ?? json.message ?? 'Неизвестная ошибка'
        setFixStates(prev => ({ ...prev, [checkId]: { status: 'failed', message: msg } }))
        appendLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'fail', before, after: msg })
        return
      }

      const afterMsg = json.message ?? 'Исправлено'
      setFixStates(prev => ({ ...prev, [checkId]: { status: 'fixed', message: afterMsg } }))
      appendLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'success', before, after: afterMsg })
    } catch (e) {
      const msg = String(e)
      setFixStates(prev => ({ ...prev, [checkId]: { status: 'failed', message: msg } }))
      appendLog({ checkName, action: FIX_ACTION_LABEL[fixId] ?? fixId, result: 'fail', before, after: msg })
    }
  }

  function handleIgnore(checkId: string) {
    setIgnoredIds(prev => new Set([...prev, checkId]))
  }

  function appendLog(params: {
    checkName: string; action: string; result: 'success' | 'fail'; before: string; after: string
  }) {
    const entry: FixLogEntry = {
      id: Date.now().toString(),
      ts: new Date().toISOString(),
      userEmail,
      ...params,
    }
    setFixLog(prev => {
      const updated = [...prev, entry]
      try { localStorage.setItem(LOG_KEY, JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  function clearLog() {
    setFixLog([])
    try { localStorage.removeItem(LOG_KEY) } catch {}
  }

  // ── Derived state ───────────────────────────────────────────────────────────

  const grouped = INITIAL_CHECKS.reduce<Record<string, string[]>>((acc, c) => {
    if (!acc[c.module]) acc[c.module] = []
    acc[c.module].push(c.id)
    return acc
  }, {})

  const byId = Object.fromEntries(checks.map(c => [c.id, c]))

  const okCount    = checks.filter(c => c.status === 'ok').length
  const warnCount  = checks.filter(c => c.status === 'warn').length
  const errorCount = checks.filter(c => c.status === 'error').length
  const total      = checks.length
  const fixedCount = Object.values(fixStates).filter(s => s.status === 'fixed').length

  const overallStatus = errorCount > 0 ? 'error' : warnCount > 0 ? 'warn' : done ? 'ok' : 'pending'

  const issues = checks.filter(
    c => (c.status === 'warn' || c.status === 'error') && !ignoredIds.has(c.id),
  ).sort((a, b) => {
    const order: Record<CheckStatus, number> = { error: 0, warn: 1, ok: 2, running: 3, pending: 4 }
    const sev: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const diff = order[a.status] - order[b.status]
    if (diff !== 0) return diff
    const ma = ISSUE_META[a.id]?.severity ?? 'low'
    const mb = ISSUE_META[b.id]?.severity ?? 'low'
    return sev[ma] - sev[mb]
  })

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      {/* Banner → AI Control Center */}
      <div className="mb-5 rounded-xl bg-violet-50 border border-violet-200 px-4 py-3 flex items-center gap-3">
        <span className="text-[16px]">🧠</span>
        <div className="flex-1">
          <p className="text-[12px] font-semibold text-violet-800">Health Check теперь входит в AI Control Center</p>
          <p className="text-[11px] text-violet-600 mt-0.5">Диагностика, AI-анализ и рекомендации — в одном месте</p>
        </div>
        <Link href="/admin/ai-control-center" className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-semibold hover:bg-violet-700 transition-colors flex-shrink-0">
          Открыть →
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110]">Проверка системы</h1>
        <p className="text-[13px] text-[#8a8a85] mt-1">
          Диагностика и восстановление всех модулей платформы MGlass
        </p>
      </div>

      {/* Summary bar */}
      {done && (
        <div className={`rounded-xl border px-5 py-4 mb-6 flex items-center gap-4 ${
          overallStatus === 'ok'   ? 'bg-emerald-50 border-emerald-200' :
          overallStatus === 'warn' ? 'bg-amber-50 border-amber-200' :
                                     'bg-red-50 border-red-200'
        }`}>
          <div className={`text-3xl ${
            overallStatus === 'ok' ? 'text-emerald-500' : overallStatus === 'warn' ? 'text-amber-500' : 'text-red-500'
          }`}>
            {overallStatus === 'ok' ? '✓' : overallStatus === 'warn' ? '⚠' : '✕'}
          </div>
          <div className="flex-1">
            <p className={`text-[15px] font-semibold ${
              overallStatus === 'ok' ? 'text-emerald-800' : overallStatus === 'warn' ? 'text-amber-800' : 'text-red-800'
            }`}>
              {overallStatus === 'ok'   ? 'Система работает нормально' :
               overallStatus === 'warn' ? 'Есть предупреждения' :
                                          'Обнаружены ошибки'}
            </p>
            <p className="text-[12px] text-[#6b6b66] mt-0.5">
              {okCount} ОК · {warnCount} предупреждений · {errorCount} ошибок · всего {total} проверок
              {fixedCount > 0 && ` · ${fixedCount} исправлено`}
              {startedAt && ` · ${startedAt.toLocaleTimeString('ru-RU')}`}
            </p>
          </div>
        </div>
      )}

      {/* Run button */}
      <button
        onClick={startCheck}
        disabled={running}
        className={`w-full h-12 rounded-xl text-[14px] font-semibold transition-colors mb-8 ${
          running
            ? 'bg-[#f0f0ec] text-[#9a9a95] cursor-not-allowed'
            : 'bg-[#111110] text-white hover:bg-[#27272a] active:bg-[#3f3f46]'
        }`}
      >
        {running ? '⟳  Проверка...' : done ? 'Запустить проверку повторно' : 'Запустить проверку системы'}
      </button>

      {/* ── Issues panel ──────────────────────────────────────────────────── */}
      {done && issues.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-[14px] font-semibold text-[#2a2a28]">Ошибки и предупреждения</h2>
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              errorCount > 0 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {issues.length}
            </span>
            {!canFix && (
              <span className="text-[11px] text-[#9a9a95] ml-2">
                Автоисправление доступно только администратору
              </span>
            )}
          </div>
          <div className="space-y-3">
            {issues.map(check => {
              const meta = ISSUE_META[check.id]
              if (!meta) return null
              return (
                <IssueCard
                  key={check.id}
                  check={check}
                  meta={meta}
                  fixState={fixStates[check.id] ?? { status: 'idle' }}
                  canFix={canFix}
                  onFix={handleFix}
                  onIgnore={handleIgnore}
                />
              )
            })}
          </div>

          {/* Re-run button after fixes */}
          {fixedCount > 0 && (
            <button
              onClick={startCheck}
              className="mt-4 w-full h-10 rounded-xl text-[13px] font-semibold border border-[#d8d8d4] text-[#4a4a46] hover:bg-[#f0f0ec] transition-colors"
            >
              Запустить проверку повторно
            </button>
          )}
        </div>
      )}

      {/* All OK message */}
      {done && issues.length === 0 && errorCount === 0 && warnCount === 0 && (
        <div className="mb-8 rounded-xl bg-emerald-50 border border-emerald-200 px-5 py-4 text-center">
          <p className="text-[13px] text-emerald-700 font-medium">
            Проблем не обнаружено — система работает нормально
          </p>
        </div>
      )}

      {/* ── Checks by module ──────────────────────────────────────────────── */}
      <div className="space-y-4">
        {Object.entries(grouped).map(([module, ids]) => {
          const moduleChecks = ids.map(id => byId[id]).filter(Boolean)
          const modError = moduleChecks.some(c => c.status === 'error')
          const modWarn  = moduleChecks.some(c => c.status === 'warn')
          const modOk    = moduleChecks.every(c => c.status === 'ok')
          const modRun   = moduleChecks.some(c => c.status === 'running')
          const badge = modRun ? 'running' : modError ? 'error' : modWarn ? 'warn' : modOk ? 'ok' : 'pending'

          return (
            <div key={module} className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#f2f2f0] bg-[#fafaf8]">
                <span className="text-[12px] font-semibold text-[#4b4b47] uppercase tracking-wide">
                  {module}
                </span>
                <span className={`text-[11px] font-mono font-bold ${STATUS_COLOR[badge]}`}>
                  {STATUS_ICON[badge]}{' '}
                  {badge === 'running' ? 'проверка...' :
                   badge === 'ok'      ? 'ок' :
                   badge === 'warn'    ? 'предупреждение' :
                   badge === 'error'   ? 'ошибка' : '—'}
                </span>
              </div>

              <div className="divide-y divide-[#f5f5f3]">
                {moduleChecks.map(c => (
                  <div key={c.id} className={`flex items-start gap-3 px-4 py-3 ${STATUS_BG[c.status]} transition-colors`}>
                    <span className={`text-[13px] font-bold mt-0.5 flex-shrink-0 ${STATUS_COLOR[c.status]}`}>
                      {STATUS_ICON[c.status]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-medium text-[#2a2a28]">{c.name}</span>
                        {c.ms != null && (
                          <span className="text-[10px] text-[#c0c0bc] font-mono">{c.ms}ms</span>
                        )}
                        {fixStates[c.id]?.status === 'fixed' && (
                          <span className="text-[10px] text-emerald-600 font-semibold">✓ исправлено</span>
                        )}
                      </div>
                      {c.detail && (
                        <p className={`text-[11px] mt-0.5 ${
                          c.status === 'error' ? 'text-red-600' :
                          c.status === 'warn'  ? 'text-amber-600' :
                                                 'text-[#6b6b66]'
                        }`}>
                          {c.detail}
                        </p>
                      )}
                      {c.hint && (
                        <p className="text-[11px] text-[#9a9a95] mt-0.5 italic">{c.hint}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Fix log */}
      <FixLogSection entries={fixLog} onClear={clearLog} />

      {/* Legend */}
      <div className="mt-8 flex gap-4 text-[11px] text-[#9a9a95]">
        <span className="text-emerald-600 font-semibold">✓ Работает</span>
        <span className="text-amber-500 font-semibold">⚠ Предупреждение</span>
        <span className="text-red-500 font-semibold">✕ Ошибка</span>
      </div>

    </div>
  )
}
