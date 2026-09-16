// Один замок на всего Ивана: отвечает бот или молчит.
//
// Раньше правило «чат забрал человек» выводилось из поля crm_leads.manager, и список
// имён AI-менеджеров был скопирован в четырёх файлах (вебхук, фоллоу-ап, догон, тред).
// Списки разъезжались — так бот однажды продолжил писать в чат, забранный человеком.
// Теперь имена и правило живут здесь, а решение опирается на явный флаг bot_muted.
//
// Флаг взводится в трёх местах: менеджер написал клиенту (из CRM или из амо — второе
// прилетает к нам эхом нашего же аккаунта), менеджеру назначили карточку (триггер в
// базе на UPDATE crm_leads.manager), или руками с карточки. Снимается только явно:
// ответственный снова «Иван (AI)».

export const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер']

export const isAiManager = (m?: string | null): boolean => !!m && AI_MANAGERS.includes(m)

export type GateLead = {
  manager?: string | null
  bot_muted?: boolean | null
  bot_muted_by?: string | null
  stage?: string | null
  status?: string | null
}

export type GateVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'muted' | 'human' | 'past_qualification' | 'closed'; who: string | null }

// Можно ли Ивану писать клиенту в этом чате. qualificationStages передаём снаружи,
// чтобы зоны воронки остались в одном месте (lib/crmStages).
export function botGate(lead: GateLead, qualificationStages?: Set<string>): GateVerdict {
  if (lead.bot_muted) return { allowed: false, reason: 'muted', who: lead.bot_muted_by ?? lead.manager ?? null }
  if (lead.manager && !isAiManager(lead.manager)) return { allowed: false, reason: 'human', who: lead.manager }
  if (lead.status === 'won' || lead.status === 'lost') return { allowed: false, reason: 'closed', who: null }
  if (qualificationStages && lead.stage && !qualificationStages.has(lead.stage)) {
    return { allowed: false, reason: 'past_qualification', who: lead.stage }
  }
  return { allowed: true }
}

export const MUTE_LABEL: Record<Exclude<GateVerdict & { allowed: false }, never>['reason'], string> = {
  muted: 'бот выключен — карточку ведёт менеджер',
  human: 'чат забрал менеджер',
  past_qualification: 'заявка вышла из квалификации',
  closed: 'сделка закрыта',
}

// Исходящее сообщение в чате Авито — наше или живого менеджера?
//
// Авито присылает наши же сообщения обратно эхом, и до 16.09.2026 вебхук просто
// выходил на них. Из-за этого ответ менеджера из амо был для бота невидим: он
// продолжал отвечать клиенту параллельно с человеком. Отличаем по тексту: если
// это дословно то, что Иван только что отправил, — эхо бота, иначе писал человек.
export function isOwnBotEcho(text: string, recentBotTexts: string[]): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
  const t = norm(text)
  if (!t) return true   // пустое эхо не считаем работой менеджера
  return recentBotTexts.some(b => norm(b) === t)
}
