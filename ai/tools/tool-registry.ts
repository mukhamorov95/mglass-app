// ai/tools/tool-registry.ts
//
// Декларативный реестр инструментов AI-агентов M-Glass.
// ТОЛЬКО типы и описания — без реального выполнения.
// Нет импортов Supabase, Anthropic или внешних модулей.
// Реальные реализации подключаются на этапе 2 из lib/ai-tools/.

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
  | 'read_only'        // только чтение, никаких изменений
  | 'draft'            // создание черновика, не отправляется без подтверждения
  | 'suggest'          // предложение действия, ждёт одобрения
  | 'approve_required' // требует явного подтверждения Владислава
  | 'execute'          // выполняет действие (только явно разрешённые агенты)
  | 'admin'            // системный уровень, только вручную

// ─── Уровни риска ────────────────────────────────────────────────────────────

export type ToolRiskLevel =
  | 'low'      // чтение без side effects
  | 'medium'   // создаёт артефакт, требует approval перед использованием
  | 'high'     // мутирует данные или отправляет вовне
  | 'critical' // необратимо, только вручную человеком

// ─── Режим выполнения ────────────────────────────────────────────────────────

export type ToolExecutionMode =
  | 'read_only'        // нет изменений состояния, безопасно вызывать в любое время
  | 'draft'            // создаёт черновик-артефакт, не сохраняется до approval
  | 'approve_required' // ждёт явного approve человека перед любым эффектом
  | 'execute'          // выполняет реальное действие, только после явного approval

// ─── Описание инструмента ────────────────────────────────────────────────────

export type ToolDefinition = {
  key:                      string
  description:              string
  permission:               ToolPermission
  riskLevel:                ToolRiskLevel
  executionMode:            ToolExecutionMode
  allowedAgents:            AgentKey[]
  usedBySkills:             SkillKey[]
  dataSource:               'supabase' | 'amocrm' | 'internal' | 'calculator'
  returnsData:              boolean
  mutatesData:              boolean
  requiresHumanConfirmation: boolean
}

// ─── Тип результата проверки ─────────────────────────────────────────────────

export type ToolAssertResult =
  | { allowed: true }
  | { allowed: false; reason: string }

// ─── Реестр инструментов ─────────────────────────────────────────────────────
// Все инструменты декларативны. Реализации подключаются на этапе 2.

export const TOOL_REGISTRY: ToolDefinition[] = [

  // ── Быстрый расчёт через существующий quickCalc ──────────────────────────
  {
    key:           'quickCalc',
    description:   'Выполнить предварительный расчёт через lib/quickCalc.ts или POST /api/calc/quick. Чистая функция — нет записи в БД. Поддерживает mirror, shower, loft.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['proposal-engineer', 'finance-controller'],
    usedBySkills:  ['create-commercial-proposal', 'check-margin'],
    dataSource:    'calculator',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Создание черновика КП через существующий generate-kp ─────────────────
  {
    key:           'generateKpDraft',
    description:   'Создать черновик КП через POST /api/ai/generate-kp. Использует Anthropic + данные из Supabase calculations. ЧЕРНОВИК — не отправляется клиенту без явного approval.',
    permission:    'draft',
    riskLevel:     'medium',
    executionMode: 'draft',
    allowedAgents: ['proposal-engineer'],
    usedBySkills:  ['create-commercial-proposal'],
    dataSource:    'calculator',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: true,
  },

  // ── Чтение правил ценообразования ────────────────────────────────────────
  {
    key:           'readPricingRules',
    description:   'Прочитать правила ценообразования из Supabase (financial_settings, pricing_formula, discount_limits). Только чтение.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['proposal-engineer', 'finance-controller', 'chief-of-staff'],
    usedBySkills:  ['create-commercial-proposal', 'check-margin'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение правил продукта ────────────────────────────────────────────────
  {
    key:           'readProductRules',
    description:   'Прочитать правила продукта: тип стекла, толщины, ограничения размеров, совместимость материалов. Источник: Supabase + lib/types.ts.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['proposal-engineer', 'production-dispatcher'],
    usedBySkills:  ['create-commercial-proposal', 'check-catalog-item'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение шаблонов предложений ───────────────────────────────────────────
  {
    key:           'readProposalTemplates',
    description:   'Прочитать существующие шаблоны КП из Supabase. Используется для форматирования черновика по стандарту M-Glass.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['proposal-engineer'],
    usedBySkills:  ['create-commercial-proposal'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение расчётов и КП ─────────────────────────────────────────────────
  {
    key:           'getCalculations',
    description:   'Получить список расчётов (КП) из Supabase. Фильтрация по менеджеру, периоду, типу продукта.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'finance-controller'],
    usedBySkills:  ['create-commercial-proposal', 'check-margin', 'audit-manager-work'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение сделок CRM ────────────────────────────────────────────────────
  {
    key:           'getRecentDeals',
    description:   'Получить активные сделки из AmoCRM. Только GET. Фильтрация по менеджеру, зоне воронки, дате.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'production-dispatcher'],
    usedBySkills:  ['analyze-crm-day', 'audit-manager-work', 'check-order-before-production'],
    dataSource:    'amocrm',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение справочника фурнитуры ─────────────────────────────────────────
  {
    key:           'getCatalogItems',
    description:   'Получить позиции из справочника душевой или зеркальной фурнитуры (shower_catalog_items). Только активные позиции.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['proposal-engineer', 'production-dispatcher', 'finance-controller'],
    usedBySkills:  ['check-catalog-item', 'create-commercial-proposal'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Чтение производственных заказов ──────────────────────────────────────
  {
    key:           'getProductionOrders',
    description:   'Получить заказы в зоне 3 (Производство) из AmoCRM. Только GET.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['production-dispatcher', 'chief-of-staff', 'finance-controller'],
    usedBySkills:  ['check-order-before-production', 'generate-production-plan'],
    dataSource:    'amocrm',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Создание черновика КП (внутренний, без Anthropic) ─────────────────────
  {
    key:           'createProposalDraft',
    description:   'Создать черновик КП на основе данных из калькулятора. ЧЕРНОВИК — не отправляется клиенту без явного подтверждения. Расчёты только через TypeScript-калькулятор, не LLM.',
    permission:    'draft',
    riskLevel:     'medium',
    executionMode: 'draft',
    allowedAgents: ['proposal-engineer'],
    usedBySkills:  ['create-commercial-proposal'],
    dataSource:    'calculator',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: true,
  },

  // ── Проверка маржи ────────────────────────────────────────────────────────
  {
    key:           'checkMargin',
    description:   'Проверить маржинальность расчёта или сделки. Использует financial_settings из Supabase и данные из calculations. Только чтение — не изменяет цены.',
    permission:    'read_only',
    riskLevel:     'low',
    executionMode: 'read_only',
    allowedAgents: ['finance-controller', 'proposal-engineer', 'chief-of-staff'],
    usedBySkills:  ['check-margin', 'create-commercial-proposal'],
    dataSource:    'supabase',
    returnsData:              true,
    mutatesData:              false,
    requiresHumanConfirmation: false,
  },

  // ── Запись в лог агента ───────────────────────────────────────────────────
  {
    key:           'writeAgentLog',
    description:   'Записать событие в лог действий агента (agent_logs таблица Supabase). Логируется: агент, skill, действие, payload, статус, требовалось ли подтверждение.',
    permission:    'execute',
    riskLevel:     'low',
    executionMode: 'execute',
    allowedAgents: ['chief-of-staff', 'sales-director', 'proposal-engineer', 'production-dispatcher', 'finance-controller'],
    usedBySkills:  ['create-commercial-proposal', 'check-catalog-item', 'check-order-before-production', 'analyze-crm-day', 'generate-production-plan', 'check-margin', 'audit-manager-work'],
    dataSource:    'supabase',
    returnsData:              false,
    mutatesData:              true,
    requiresHumanConfirmation: false,
  },

]

// ─── Вспомогательные функции (чистые, без side effects) ──────────────────────

/** Найти инструмент по ключу */
export function getToolDefinition(key: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find(t => t.key === key)
}

/** Найти инструмент по ключу (алиас для обратной совместимости) */
export const getTool = getToolDefinition

/** Получить все инструменты для конкретного агента */
export function listToolsForAgent(agentKey: AgentKey): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.allowedAgents.includes(agentKey))
}

/** Получить все инструменты, которые использует конкретный skill */
export function listToolsForSkill(skillKey: SkillKey): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.usedBySkills.includes(skillKey))
}

/** Получить все инструменты агента (алиас для обратной совместимости) */
export const getAgentTools = listToolsForAgent

/** Проверить, разрешён ли конкретный tool для данного агента в данном skill.
 *  Чистая функция — нет side effects, нет throws. */
export function assertToolAllowed(
  agentKey: AgentKey,
  skillKey: SkillKey,
  toolKey: string,
): ToolAssertResult {
  const tool = getToolDefinition(toolKey)

  if (!tool) {
    return { allowed: false, reason: `Tool "${toolKey}" not found in registry` }
  }

  if (!tool.allowedAgents.includes(agentKey)) {
    return { allowed: false, reason: `Agent "${agentKey}" is not permitted to use tool "${toolKey}"` }
  }

  if (tool.usedBySkills.length > 0 && !tool.usedBySkills.includes(skillKey)) {
    return { allowed: false, reason: `Tool "${toolKey}" is not listed for skill "${skillKey}"` }
  }

  return { allowed: true }
}

/** Получить инструменты, требующие подтверждения человека */
export function getApprovalRequiredTools(): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.requiresHumanConfirmation)
}

/** Получить инструменты по уровню риска */
export function getToolsByRisk(riskLevel: ToolRiskLevel): ToolDefinition[] {
  return TOOL_REGISTRY.filter(t => t.riskLevel === riskLevel)
}
