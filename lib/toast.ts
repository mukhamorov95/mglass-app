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
  // Vercel отдаёт вместо JSON свою страницу, когда функция не уложилась в лимит времени
  if (r.status === 504 || r.headers.get('x-vercel-error') === 'FUNCTION_INVOCATION_TIMEOUT') return 'Сервер не успел посчитать за отведённое время (504)'
  if (r.status >= 500) return `Ошибка сервера (${r.status})`
  return `Сервер ответил ${r.status}`
}

// Для catch у fetch: запрос не дошёл до сервера или ответ не прочитался.
export const NETWORK_ERROR = 'Сервер не ответил — проверьте связь'

// Загрузка JSON с причиной словами. Статус смотрим до разбора: страница ошибки платформы
// вместо JSON иначе превращается в «Unexpected token 'A'… is not valid JSON» на экране.
export async function loadJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<{ data: T; error: null } | { data: null; error: string }> {
  let r: Response
  try { r = await fetch(input, init) } catch { return { data: null, error: NETWORK_ERROR } }
  if (!r.ok) return { data: null, error: await responseError(r) }
  const data = await r.json().catch(() => undefined) as T | undefined
  if (data === undefined) return { data: null, error: `Сервер прислал страницу вместо данных (${r.status})` }
  return { data, error: null }
}

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
