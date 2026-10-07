// Просчёт партнёра до запуска: что с ним сейчас и что партнёру можно с ним делать.
// Править и отправлять в работу можно только черновик (notes.status = 'quote'):
// маршруты правки и отправки отказывают остальным, и экран обязан говорить то же.

export type QuoteState = 'draft' | 'submitted' | 'negotiation' | 'agreed' | 'rejected'

export function quoteState(status: string | null | undefined): QuoteState {
  switch (status) {
    case undefined: case null: case '': case 'quote': return 'draft'
    case 'pending_approval': return 'submitted'
    case 'negotiation': return 'negotiation'
    case 'rejected': case 'cancelled': return 'rejected'
    default: return 'agreed'
  }
}

export const QUOTE_LABEL: Record<QuoteState, string> = {
  draft: 'Черновик',
  submitted: 'Отправлен в работу',
  negotiation: 'Обсуждается с менеджером',
  agreed: 'Согласован — менеджер запустит в работу',
  rejected: 'Отклонён',
}

export const canEditQuote = (s: QuoteState) => s === 'draft'
export const canSubmitQuote = (s: QuoteState) => s === 'draft'

// Отказ правки или отправки — словами, одинаково для маршрута и экрана.
export function quoteLockReason(s: QuoteState): string | null {
  switch (s) {
    case 'draft': return null
    case 'submitted': return 'Просчёт уже отправлен в работу — менеджер проверяет его'
    case 'negotiation': return 'Просчёт обсуждается с менеджером — изменения согласуйте с ним'
    case 'agreed': return 'Просчёт согласован с менеджером — изменения согласуйте с ним'
    case 'rejected': return 'Просчёт отклонён — повторите его как новый'
  }
}
