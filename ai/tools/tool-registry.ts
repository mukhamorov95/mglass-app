// ai/tools/tool-registry.ts
//
// Декларативный реестр инструментов AI-агентов M-Glass.
// Это ТОЛЬКО типы и описания — без реального выполнения.
// Реальные реализации будут в lib/ai-tools/ на следующих этапах.

// ─── Ключи агентов ────────────────────────────────────────────────────────────

export type AgentKey =
  | 'chief-of-staff'
  | 'sales-director'
  | 'proposal-engineer'
  | 'production-dispatcher'
  | 'finance-controller'

// ─── Ключи навыков ───────────────────────────────────────────────────────────

export type SkillKey =
  | 'create-commercial-proposal'
  | 'check-catalog-item'
  | 'check-order-before-production'
  | 'analyze-crm-day'
  | 'generate-production-plan'
  | 'check-margin'
  | 'audit-manager-work'

// ─── Уровни разрешений ───────────────────────────────────────────────────────

export type ToolPermission =
  | 'read_only'       // только чтение, никаких изменений
  | 'draft'           // создание черновика, не отправляется без подтверждения
  | 'suggest'         // предложение действия, ждёт одобрения
  | 'approve_required'// требует явного подтверждения Владислава
  | 'execute'         // выполняет действие (только явно разрешённые агенты)
  | 'admin'           // системный уровень

// ─── Описание инструмента ────────────────────────────────────────────────────

export type ToolDefinition = {
  key: string
  description: string
  permission: ToolPermission
  allowedAgents: AgentKey[]
  dataSource: 'supabase' | 'amocrm' | 'internal' | 'calculator'
  returnsData: boolean
  mutatesData: boolean
  requiresHumanConfirmation: boolean
}

// ─── Реестр инструментов ─────────────────────────────────────────────────────
// Все инструменты декларативны — реализации будут добавлены на этапе 2.

export const TOOL_REGISTRY: ToolDefinition[] = [

  // ── Чтение расчётов и КП ─────────────────────────────────────────────────
  {
    key: 'getCalculations',
    description: 'Получить список расчётов (КП) из Supabase. Фильтрация по менеджеру, периоду, типу продукта.',
    permission: 'read_only',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'finance-controller'],
    dataSource: 'supabase',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение сделок CRM ────────────────────────────────────────────────────
  {
    key: 'getRecentDeals',
    description: 'Получить активные сделки из AmoCRM. Только GET. Фильтрация по менеджеру, зоне воронки, дате.',
    permission: 'read_only',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'production-dispatcher'],
    dataSource: 'amocrm',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение справочника фурнитуры ─────────────────────────────────────────
  {
    key: 'getCatalogItems',
    description: 'Получить позиции из справочника душевой или зеркальной фурнитуры (shower_catalog_items).',
    permission: 'read_only',
    allowedAgents: ['proposal-engineer', 'production-dispatcher', 'finance-controller'],
    dataSource: 'supabase',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение производственных заказов ──────────────────────────────────────
  {
    key: 'getProductionOrders',
    description: 'Получить заказы в зоне 3 (Производство) из AmoCRM. Только GET.',
    permission: 'read_only',
    allowedAgents: ['production-dispatcher', 'chief-of-staff', 'finance-controller'],
    dataSource: 'amocrm',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: false,
  },

  // ── Создание черновика КП ─────────────────────────────────────────────────
  {
    key: 'createProposalDraft',
    description: [
      'Создать черновик КП на основе данных из калькулятора.',
      'ЧЕРНОВИК — не отправляется клиенту без явного подтверждения.',
      'Расчёты выполняются только TypeScript-калькулятором, не языковой моделью.',
    ].join(' '),
    permission: 'draft',
    allowedAgents: ['proposal-engineer'],
    dataSource: 'calculator',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: true,
  },

  // ── Проверка маржи ────────────────────────────────────────────────────────
  {
    key: 'checkMargin',
    description: [
      'Проверить маржинальность расчёта или сделки.',
      'Использует financial_settings из Supabase и данные из calculations.',
      'Только чтение — не изменяет цены.',
    ].join(' '),
    permission: 'read_only',
    allowedAgents: ['finance-controller', 'proposal-engineer', 'chief-of-staff'],
    dataSource: 'supabase',
    returnsData: true,
    mutatesData: false,
    requiresHumanConfirmation: false,
  },

  // ── Запись в лог агента ───────────────────────────────────────────────────
  {
    key: 'writeAgentLog',
    description: [
      'Записать событие в лог действий агента (agent_logs таблица Supabase).',
      'Логируется: агент, skill, действие, payload, статус, требовалось ли подтверждение.',
    ].join(' '),
    permission: 'execute',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'production-dispatcher', 'finance-controller'],
    dataSource: 'supabase',
    returnsData: false,
    mutatesData: true,
    requiresHumanConfirmation: false,
  },

]

// ─── Вспомогательные функции (декларативно) ──────────────────────────────────

/** Найти инструмент по ключу */
export function getTool(key: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find(t => t.key === key)
}

/** Проверить, может ли агент использовать инструмент */
export function canAgentUseTool(agent: AgentKey, toolKey: string): boolean {
  const tool = getTool(toolKey)
  return tool ? tool.allowedAgents.includes(agent) : false
}

/** Получить все инструменты агента */
export function getAgentTools(agent: AgentKey): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.allowedAgents.includes(agent))
}

/** Получить инструменты, требующие подтверждения человека */
export function getApprovalRequiredTools(): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.requiresHumanConfirmation)
}
