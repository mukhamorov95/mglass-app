// Уведомления без React: любой код шлёт событие, <Toaster /> в корневом layout
// его рисует. Так тост можно вызвать из обработчика, хелпера или catch без
// контекста и провайдеров.

export type ToastKind = 'success' | 'error' | 'info'
export type ToastAction = { label: string; onClick: () => void }
export type ToastOptions = {
  detail?: string
  action?: ToastAction
  // Только для success/info: ошибка висит, пока человек её не закроет.
  durationMs?: number
}
export type ToastPayload = ToastOptions & { id: number; kind: ToastKind; title: string }

export const TOAST_EVENT = 'mg:toast'

let seq = 0

function emit(kind: ToastKind, title: string, opts: ToastOptions = {}): void {
  if (typeof window === 'undefined') return
  const payload: ToastPayload = { ...opts, id: ++seq, kind, title }
  window.dispatchEvent(new CustomEvent<ToastPayload>(TOAST_EVENT, { detail: payload }))
}

export const toast = {
  success: (title: string, opts?: ToastOptions) => emit('success', title, opts),
  error: (title: string, opts?: ToastOptions) => emit('error', title, opts),
  info: (title: string, opts?: ToastOptions) => emit('info', title, opts),
}

// Причина отказа сервера словами: наши API отдают { error }, остальное — код ответа.
export async function responseError(r: Response): Promise<string> {
  const j = await r.clone().json().catch(() => null) as { error?: unknown } | null
  if (j && typeof j.error === 'string' && j.error.trim()) return j.error
  if (r.status === 401) return 'Сессия истекла — войдите заново'
  if (r.status === 403) return 'Нет прав на это действие'
  if (r.status >= 500) return `Ошибка сервера (${r.status})`
  return `Сервер ответил ${r.status}`
}

// Для catch у fetch: запрос не дошёл до сервера или ответ не прочитался.
export const NETWORK_ERROR = 'Сервер не ответил — проверьте связь'

// Запись с честным исходом: не ок или сеть упала → toast.error(failTitle) с
// причиной и подсказкой, что делать; вызывающему — null. Ок → сам ответ.
export async function sendOrToast(
  failTitle: string,
  input: RequestInfo | URL,
  init?: RequestInit,
  hint?: string,
): Promise<Response | null> {
  const withHint = (reason: string) => (hint ? `${reason}. ${hint}` : reason)
  try {
    const r = await fetch(input, init)
    if (r.ok) return r
    toast.error(failTitle, { detail: withHint(await responseError(r)) })
    return null
  } catch {
    toast.error(failTitle, { detail: withHint(NETWORK_ERROR) })
    return null
  }
}
