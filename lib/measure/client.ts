import { confirmDialog } from '@/lib/dialog'

// Запрос к API замеров из браузера с одним общим поведением: мягкий конфликт
// (мало времени на дорогу, вне часов, нерабочий день) сервер возвращает вопросом —
// человек отвечает «да», и запрос уходит повторно с force.

export type SendResult<T> = { ok: true; data: T } | { ok: false; error: string; cancelled?: boolean }

export async function sendMeasure<T = Record<string, unknown>>(
  url: string,
  method: 'POST' | 'PATCH',
  body: Record<string, unknown>,
  withForce: (b: Record<string, unknown>) => Record<string, unknown> = b => ({ ...b, force: true }),
): Promise<SendResult<T>> {
  const call = async (b: Record<string, unknown>) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
    return { res, j: await res.json().catch(() => ({})) as Record<string, unknown> }
  }
  let { res, j } = await call(body)
  if (res.status === 409 && j.needsConfirm) {
    const yes = await confirmDialog({ title: 'Всё равно назначить?', text: String(j.warning ?? ''), confirmLabel: 'Назначить' })
    if (!yes) return { ok: false, error: '', cancelled: true }
    ;({ res, j } = await call(withForce(body)))
  }
  if (!res.ok) return { ok: false, error: (j.error as string) || `Не сохранено (${res.status})` }
  return { ok: true, data: j as T }
}

// Сегодняшняя дата по Москве — для min у полей даты.
export const mskToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10)
