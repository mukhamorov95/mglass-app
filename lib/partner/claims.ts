// Гарантийные обращения партнёров (partner_claims): статусы, причина и проверка правки
// владельцем. Причина нужна метрике точки Т5 — «переделок по вине размера > 10 % — стоп»:
// без неё «вина размера» не отличается от брака.

export const CLAIM_STATUSES = ['open', 'in_review', 'resolved', 'rejected'] as const
export type ClaimStatus = typeof CLAIM_STATUSES[number]

export const CLAIM_STATUS_LABEL: Record<ClaimStatus, string> = {
  open: 'Принято', in_review: 'На рассмотрении', resolved: 'Решено', rejected: 'Отклонено',
}

export const CLAIM_CAUSES = ['size', 'defect', 'transport', 'other'] as const
export type ClaimCause = typeof CLAIM_CAUSES[number]

export const CLAIM_CAUSE_LABEL: Record<ClaimCause, string> = {
  size: 'Вина размера (замер/размер заказчика)',
  defect: 'Брак производства',
  transport: 'Повреждение при доставке',
  other: 'Другое',
}

export const CLAIM_KIND_LABEL: Record<string, string> = {
  boy: 'Бой / трещина', skol: 'Скол / царапина', mismatch: 'Не подошло по размеру',
  hardware: 'Проблема с фурнитурой', other: 'Другое',
}

export const isClosed = (s: ClaimStatus) => s === 'resolved' || s === 'rejected'

// cause: undefined — не трогать (колонки может ещё не быть), null — снять причину.
export type ClaimPatch = { status: ClaimStatus; resolution: string | null; cause?: ClaimCause | null }

// Правка владельца: статус из списка, ответ партнёру до 2000 знаков; закрыть обращение
// без ответа нельзя — партнёр увидит статус и должен понять почему.
export function parseClaimPatch(body: unknown): { ok: true; id: number; patch: ClaimPatch } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const id = Number(b.id)
  if (!Number.isInteger(id) || id <= 0) return { ok: false, error: 'Нет id обращения' }
  if (!(CLAIM_STATUSES as readonly string[]).includes(String(b.status))) return { ok: false, error: 'Неизвестный статус' }
  const status = b.status as ClaimStatus
  const resolution = typeof b.resolution === 'string' && b.resolution.trim() ? b.resolution.trim().slice(0, 2000) : null
  if (b.cause != null && b.cause !== '' && !(CLAIM_CAUSES as readonly string[]).includes(String(b.cause))) return { ok: false, error: 'Неизвестная причина' }
  if (isClosed(status) && !resolution) return { ok: false, error: 'Закрыть обращение без ответа партнёру нельзя — напишите, что решили' }
  const patch: ClaimPatch = { status, resolution }
  if ('cause' in b) patch.cause = b.cause ? b.cause as ClaimCause : null
  return { ok: true, id, patch }
}

// Сводка для Т5: сколько обращений по каждой причине (без причины — отдельно).
export function causeSummary(claims: { cause: ClaimCause | null }[]): Record<ClaimCause | 'none', number> {
  const out: Record<ClaimCause | 'none', number> = { size: 0, defect: 0, transport: 0, other: 0, none: 0 }
  for (const c of claims) out[c.cause ?? 'none']++
  return out
}
