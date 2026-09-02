import { createClient } from './supabase-browser'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CheckStatus = 'pending' | 'running' | 'ok' | 'warn' | 'error'
export type FixStatus   = 'idle' | 'fixing' | 'fixed' | 'failed'
export type Severity    = 'critical' | 'high' | 'medium' | 'low'

export type CheckResult = {
  id: string
  module: string
  name: string
  status: CheckStatus
  detail?: string
  hint?: string
  ms?: number
}

export type IssueMeta = {
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

export type FixLogEntry = {
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

export const STATUS_ICON: Record<CheckStatus, string> = {
  pending: '○', running: '◌', ok: '✓', warn: '⚠', error: '✕',
}
export const STATUS_COLOR: Record<CheckStatus, string> = {
  pending: 'text-[#b0b0ac]',
  running: 'text-blue-500',
  ok:      'text-emerald-600',
  warn:    'text-amber-500',
  error:   'text-red-500',
}
export const STATUS_BG: Record<CheckStatus, string> = {
  pending: 'bg-[#f4f3f1]',
  running: 'bg-blue-50',
  ok:      'bg-emerald-50',
  warn:    'bg-amber-50',
  error:   'bg-red-50',
}
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Критично', high: 'Высокий', medium: 'Средний', low: 'Низкий',
}
export const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'bg-red-100 text-red-700 border border-red-200',
  high:     'bg-orange-100 text-orange-700 border border-orange-200',
  medium:   'bg-amber-100 text-amber-700 border border-amber-200',
  low:      'bg-blue-100 text-blue-700 border border-blue-200',
}
export const FIX_ACTION_LABEL: Record<string, string> = {
  sync_b2b_materials:  'Синхронизация b2b_materials из glass_price_matrix',
  sync_b2b_from_glass: 'Деактивация устаревших позиций b2b_materials',
  fix_roles_null:      'Назначение роли manager пользователям без роли',
}
export const LOG_KEY = 'mglass_health_fix_log'

// ── Initial checks ────────────────────────────────────────────────────────────

export const INITIAL_CHECKS: Omit<CheckResult, 'status'>[] = [
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
  { id: 'b2b_materials',    module: 'B2B',           name: 'B2B материалы активны' },
  { id: 'roles_users',      module: 'Роли',          name: 'У пользователей назначены роли' },
  { id: 'roles_no_null',    module: 'Роли',          name: 'Нет пользователей без роли' },
  { id: 'api_strategy',     module: 'API',           name: 'GET /api/admin/owner-strategy' },
  { id: 'api_pricing',      module: 'API',           name: 'GET /api/admin/pricing-formula' },
  { id: 'api_glass',        module: 'API',           name: 'GET /api/admin/glass-prices' },
  { id: 'agents_fresh',     module: 'Агенты',        name: 'Включённые AI-агенты отрабатывают' },
]

// ── Issue metadata ────────────────────────────────────────────────────────────

export const ISSUE_META: Record<string, IssueMeta> = {
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
    cause: 'Матрица цен на стекло/зеркала пуста',
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
    cause: 'Таблица b2b_materials пуста',
    impact: 'B2B калькулятор не может выбрать материал',
    recommendation: 'Синхронизировать b2b_materials из glass_price_matrix',
    autoFixId: 'sync_b2b_materials',
  },
  db_users: {
    severity: 'critical',
    cause: 'Таблица users недоступна',
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
    impact: 'Расчёт маржи и себестоимости без корректных настроек',
    recommendation: 'Заполните финансовые настройки в разделе Владельца',
    instruction: {
      where: '/admin/owner → финансовые настройки',
      fields: 'target_margin, overhead_cost, vat_rate',
      data: 'Нормативы маржинальности и затрат бизнеса',
      who: 'Владислав / CEO',
      verify: 'Проверка показывает "1+ записей"',
    },
  },
  db_services: {
    severity: 'high',
    cause: 'Нет активных услуг в справочнике',
    impact: 'Калькулятор не добавляет услуги в расчёты',
    recommendation: 'Добавьте услуги монтажа и доставки в /admin/services',
    instruction: {
      where: '/admin/services',
      fields: 'Название (содержит "монтаж" / "доставка"), цена, active = true',
      data: 'Актуальные тарифы на монтаж и доставку',
      who: 'Владислав / администратор',
      verify: 'Создать расчёт — монтаж и доставка отображаются',
    },
  },
  db_led: {
    severity: 'medium',
    cause: 'Нет активных LED-компонентов в справочнике',
    impact: 'Калькулятор зеркал не рассчитывает стоимость подсветки',
    recommendation: 'Добавьте LED-компоненты в /admin/mirror-lighting',
    instruction: {
      where: '/admin/mirror-lighting',
      fields: 'component_type (led_strip / frame / power_supply), цена, active = true',
      data: 'Прайс-лист на LED-ленту, каркасы, блоки питания',
      who: 'Владислав / байер',
      verify: 'Зеркало с подсветкой — появилась стоимость LED',
    },
  },
  db_facet: {
    severity: 'low',
    cause: 'Нет активных позиций фацета',
    impact: 'Калькулятор не может добавить фацетную обработку',
    recommendation: 'Добавьте цены на фацет в /admin/facet',
    instruction: {
      where: '/admin/facet',
      fields: 'Ширина фацета, price_per_meter, active = true',
      data: 'Тарифы на шлифовку кромки',
      who: 'Владислав / байер',
      verify: 'Опция фацета появляется в калькуляторе',
    },
  },
  ref_glass_names: {
    severity: 'critical',
    cause: 'Нет записей category=mirror, price_type=cost в glass_price_matrix',
    impact: 'Калькулятор зеркал не отображает ни одного материала',
    recommendation: 'Добавьте зеркала в /admin/glass-prices',
    instruction: {
      where: '/admin/glass-prices → Зеркала → Себестоимость',
      fields: 'Категория = mirror, тип = cost, название, цена за м²',
      data: 'Прайс-лист зеркал от поставщика',
      who: 'Владислав / байер',
      verify: 'Калькулятор зеркал показывает список материалов',
    },
  },
  ref_b2b_sync: {
    severity: 'medium',
    cause: 'В b2b_materials есть активные позиции без совпадения в glass_price_matrix — устаревшие названия',
    impact: 'B2B материалы не связаны с матрицей цен — расчёт себестоимости некорректен',
    recommendation: 'Деактивировать устаревшие позиции в b2b_materials',
    autoFixId: 'sync_b2b_from_glass',
  },
  ref_led_active: {
    severity: 'high',
    cause: 'Отсутствуют некоторые типы LED-компонентов',
    impact: 'Расчёт стоимости подсветки зеркал неполный',
    recommendation: 'Добавьте все три типа компонентов в /admin/mirror-lighting',
    instruction: {
      where: '/admin/mirror-lighting',
      fields: 'Три типа: led_strip, frame, power_supply — все с active = true',
      data: 'Цены от поставщика на каждый тип',
      who: 'Владислав / байер',
      verify: 'Проверка: "LED, каркас, БП — есть"',
    },
  },
  ref_services: {
    severity: 'medium',
    cause: 'Не хватает услуг: монтаж и/или доставка',
    impact: 'Клиент не видит монтаж или доставку в расчёте',
    recommendation: 'Добавьте услуги «Монтаж» и «Доставка» в /admin/services',
    instruction: {
      where: '/admin/services',
      fields: 'Название содержит "монтаж" или "доставка", active = true',
      data: 'Актуальные тарифы',
      who: 'Владислав / администратор',
      verify: 'Создать расчёт — монтаж и доставка присутствуют',
    },
  },
  calc_recent: {
    severity: 'low',
    cause: 'Нет расчётов в системе',
    impact: 'Аналитика и отчёты пусты',
    recommendation: 'Создайте тестовый расчёт',
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
    cause: 'Расчёты с нулевой итоговой ценой',
    impact: 'Отчёты по выручке занижены',
    recommendation: 'Проверьте формулы расчёта и цены материалов',
    instruction: {
      where: '/calculations → последние записи',
      fields: 'final_price должен быть > 0',
      data: 'Цены материалов в /admin/glass-prices',
      who: 'Владислав / разработчик',
      verify: 'Новые расчёты имеют final_price > 0',
    },
  },
  calc_has_margin: {
    severity: 'medium',
    cause: 'Расчёты с аномальной маржой (< 5% или > 90%)',
    impact: 'Возможны убыточные продажи',
    recommendation: 'Проверьте настройки маржи и себестоимости',
    instruction: {
      where: '/admin/owner → Стратегия',
      fields: 'target_margin',
      data: 'Нормативная маржа бизнеса (20–60%)',
      who: 'Владислав / CEO',
      verify: 'Новые расчёты в диапазоне 10–80%',
    },
  },
  orders_table: {
    severity: 'critical',
    cause: 'Таблица orders недоступна',
    impact: 'Раздел заказов не работает',
    recommendation: 'Проверьте Supabase и доступность таблицы orders',
    instruction: {
      where: 'Supabase → Table Editor → orders',
      fields: 'Все поля таблицы',
      data: 'Схема из миграций',
      who: 'Владислав / разработчик',
      verify: 'Проверка OK, /orders открывается',
    },
  },
  orders_statuses: {
    severity: 'low',
    cause: 'Заказы с недопустимыми статусами',
    impact: 'Некорректная фильтрация в аналитике',
    recommendation: 'Обновите статусы через Supabase',
    instruction: {
      where: 'Supabase → Table Editor → orders',
      fields: 'Допустимые: draft, approved, in_work, done, cancelled, paused',
      data: 'Корректный статус для каждого заказа',
      who: 'Владислав / разработчик',
      verify: 'Проверка: "Статусы корректны"',
    },
  },
  b2b_quotes: {
    severity: 'critical',
    cause: 'Таблица b2b_quotes недоступна',
    impact: 'B2B просчёты не сохраняются',
    recommendation: 'Проверьте Supabase и RLS-политики b2b_quotes',
    instruction: {
      where: 'Supabase → Table Editor → b2b_quotes',
      fields: 'id, status, created_at',
      data: 'Схема из миграций',
      who: 'Владислав / разработчик',
      verify: 'Проверка OK с кол-вом просчётов',
    },
  },
  b2b_materials: {
    severity: 'high',
    cause: 'Нет активных B2B материалов',
    impact: 'B2B калькулятор не может выбрать материал',
    recommendation: 'Синхронизируйте b2b_materials из glass_price_matrix',
    autoFixId: 'sync_b2b_materials',
  },
  roles_users: {
    severity: 'medium',
    cause: 'Пользователи без роли',
    impact: 'Такие пользователи не могут войти в систему',
    recommendation: 'Назначьте роли в /admin/users',
    instruction: {
      where: '/admin/users',
      fields: 'Поле role для каждого пользователя',
      data: 'admin / manager / buyer / ceo / production / seo',
      who: 'Владислав / администратор',
      verify: 'Все пользователи имеют роль',
    },
  },
  roles_no_null: {
    severity: 'high',
    cause: 'Пользователи с role = NULL',
    impact: 'Заблокированы или получают ошибки доступа',
    recommendation: 'Назначить роль manager всем без роли',
    autoFixId: 'fix_roles_null',
  },
  api_strategy: {
    severity: 'high',
    cause: 'API owner-strategy недоступен или без target_margin',
    impact: 'Калькуляторы не применяют целевую маржу',
    recommendation: 'Заполните стратегию в разделе Владельца',
    instruction: {
      where: '/admin/owner → стратегия',
      fields: 'target_margin',
      data: 'Целевая маржа бизнеса',
      who: 'Владислав / CEO',
      verify: 'API возвращает target_margin > 0',
    },
  },
  api_pricing: {
    severity: 'high',
    cause: 'API pricing-formula пустой или недоступен',
    impact: 'Неверные формулы ценообразования',
    recommendation: 'Настройте формулу ценообразования',
    instruction: {
      where: '/admin/pricing-formula',
      fields: 'Массив параметров формулы',
      data: 'Коэффициенты расчёта final_price',
      who: 'Владислав / разработчик',
      verify: 'API возвращает непустой массив',
    },
  },
  api_glass: {
    severity: 'critical',
    cause: 'API glass-prices возвращает ошибку',
    impact: 'Все калькуляторы не работают',
    recommendation: 'Проверьте route /api/admin/glass-prices',
    instruction: {
      where: 'app/api/admin/glass-prices/route.ts',
      fields: 'HTTP 200 + JSON массив',
      data: 'Данные из glass_price_matrix',
      who: 'Владислав / разработчик',
      verify: 'Калькулятор загружает материалы без ошибки',
    },
  },
}

// ── runChecks ─────────────────────────────────────────────────────────────────

export async function runChecks(
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
    if (!data?.length) return { status: 'warn', detail: 'Нет настроек' }
    return { status: 'ok', detail: `${data.length}+ записей` }
  })
  await check('db_services', async () => {
    const { count, error } = await sb.from('services').select('*', { count: 'exact', head: true }).eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Нет активных услуг' }
    return { status: 'ok', detail: `${count} активных` }
  })
  await check('db_led', async () => {
    const { count, error } = await sb.from('mirror_lighting_components').select('*', { count: 'exact', head: true }).eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    if ((count ?? 0) === 0) return { status: 'warn', detail: 'Нет LED-компонентов' }
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
    if (!data?.length) return { status: 'error', detail: 'Нет записей mirror/cost' }
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
    if (!hasLed)   return { status: 'error', detail: 'Нет активных LED-лент' }
    if (!hasFrame) return { status: 'warn',  detail: 'Нет каркасных профилей' }
    if (!hasPsu)   return { status: 'warn',  detail: 'Нет блоков питания' }
    return { status: 'ok', detail: 'LED, каркас, БП — есть' }
  })
  await check('ref_services', async () => {
    const { data, error } = await sb.from('services').select('name').eq('active', true)
    if (error) return { status: 'error', detail: error.message }
    const names = (data ?? []).map(s => s.name.toLowerCase())
    const hasInstall  = names.some(n => n.includes('монтаж'))
    const hasDelivery = names.some(n => n.includes('доставка'))
    if (!hasInstall)  return { status: 'warn', detail: 'Нет услуги «Монтаж»' }
    if (!hasDelivery) return { status: 'warn', detail: 'Нет услуги «Доставка»' }
    return { status: 'ok', detail: `${data?.length} услуг, монтаж + доставка есть` }
  })
  await check('calc_recent', async () => {
    const { data, error } = await sb.from('calculations').select('id, created_at').order('created_at', { ascending: false }).limit(5)
    if (error) return { status: 'error', detail: error.message }
    if (!data?.length) return { status: 'warn', detail: 'Нет расчётов' }
    return { status: 'ok', detail: `Последний: ${new Date(data[0].created_at).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}` }
  })
  await check('calc_has_price', async () => {
    const { data, error } = await sb.from('calculations').select('final_price').order('created_at', { ascending: false }).limit(20)
    if (error) return { status: 'error', detail: error.message }
    const zero = (data ?? []).filter(c => !c.final_price || c.final_price <= 0)
    if (zero.length > 3) return { status: 'warn', detail: `${zero.length}/20 расчётов с нулевой ценой` }
    return { status: 'ok', detail: 'Все последние расчёты имеют цену' }
  })
  await check('calc_has_margin', async () => {
    const { data, error } = await sb.from('calculations').select('margin').order('created_at', { ascending: false }).limit(20)
    if (error) return { status: 'error', detail: error.message }
    const bad = (data ?? []).filter(c => c.margin != null && (c.margin < 5 || c.margin > 90))
    if (bad.length > 2) return { status: 'warn', detail: `${bad.length}/20 с аномальной маржой` }
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
    if (bad.length) return { status: 'warn', detail: `${bad.length} с неизвестным статусом` }
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
    if (data?.length) return { status: 'warn', detail: `${data.length} пользователей без роли` }
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
    return { status: Array.isArray(json) && json.length > 0 ? 'ok' : 'warn', detail: Array.isArray(json) ? `${json.length} параметров` : 'Неожиданный формат' }
  })
  await check('api_glass', async () => {
    const r = await fetch('/api/admin/glass-prices')
    if (!r.ok) return { status: 'error', detail: `HTTP ${r.status}` }
    return { status: 'ok', detail: `HTTP ${r.status}` }
  })
  // Слепая зона: health проверял таблицы/API, но не то, что ВКЛючённые AI-агенты
  // реально отрабатывают. Агент мог тихо встать (нет крона, ошибка) — а health зелёный.
  await check('agents_fresh', async () => {
    const { data, error } = await sb.from('agent_settings').select('agent_key, enabled, last_run_at')
    if (error) return { status: 'error', detail: error.message }
    const enabled = (data ?? []).filter(a => a.enabled)
    if (!enabled.length) return { status: 'ok', detail: 'Нет включённых агентов' }
    const STALE_MS = 2 * 24 * 60 * 60 * 1000
    const stale = enabled.filter(a => !a.last_run_at || Date.now() - new Date(a.last_run_at as string).getTime() > STALE_MS)
    if (stale.length) return {
      status: 'warn',
      detail: `Не отрабатывали >2 дней: ${stale.map(a => a.agent_key).join(', ')}`,
      hint: 'Проверьте расписание в vercel.json и логи агента (/admin/agents)',
    }
    return { status: 'ok', detail: `${enabled.length} включённых, все свежие` }
  })
}
