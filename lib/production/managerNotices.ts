import { stageLabel } from '@/lib/productionStages'
import { REWORK_REASON_LABELS, foundAtLabel } from './rework'

// Тексты личных сообщений менеджеру о событиях цеха (notifyOrderManager, Telegram, HTML).
// Менеджер узнавал об упаковке и браке случайно — заказ лежал упакованным неделями
// (на 07.10 — 78 дольше 7 дней), а о переделке он слышал от клиента.

type OrderRef = { id: number; custom_number?: string | null; client_name?: string | null }

// Telegram с parse_mode HTML отвергает сообщение целиком из-за одного «<» в комментарии.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const orderNumber = (o: OrderRef) => o.custom_number?.trim() || `#${o.id}`

export const orderLink = (orderId: number) => `/b2b-deal/${orderId}`

export function packagedNotice(o: OrderRef): string {
  const client = o.client_name?.trim()
  return `📦 Заказ <b>${escapeHtml(orderNumber(o))}</b> упакован — согласуйте отгрузку с клиентом`
    + (client ? `\n${escapeHtml(client)}` : '')
}

export function reworkNotice(o: OrderRef, r: {
  foundAt: string
  restartAt: string
  reason: string
  comment: string | null
  itemIndex: number
  by: string | null
  reopened?: number
}): string {
  const reason = REWORK_REASON_LABELS[r.reason] ?? r.reason
  // Маршрут не переоткрыт (деталь уже прошла цех — рекламация, «другое» после упаковки):
  // фраза «снова с этапа» была бы неправдой, решение о переделке — за менеджером.
  const route = r.reopened === 0
    ? `Поз. ${r.itemIndex + 1}: маршрут в цеху не менялся — нужна ли переделка, решаете вы.`
    : `Поз. ${r.itemIndex + 1} снова с этапа «${escapeHtml(stageLabel(r.restartAt))}» — срок может сдвинуться.`
  const lines = [
    `🛠 Брак/переделка по заказу <b>${escapeHtml(orderNumber(o))}</b>: ${escapeHtml(foundAtLabel(r.foundAt, stageLabel))}, ${escapeHtml(reason)}`
      + (r.comment ? ` — ${escapeHtml(r.comment)}` : ''),
    route,
  ]
  if (o.client_name?.trim()) lines.push(escapeHtml(o.client_name.trim()))
  if (r.by) lines.push(`Отметил: ${escapeHtml(r.by)}`)
  return lines.join('\n')
}
