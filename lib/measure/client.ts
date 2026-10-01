import { confirmDialog, promptDialog } from '@/lib/dialog'

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

// Готовые периоды «Заработка» и «Истории»: этот месяц, прошлый, год (по сегодня).
export type PeriodPreset = 'month' | 'prev' | 'year'
export function periodRange(kind: PeriodPreset, today = mskToday()): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number)
  if (kind === 'year') return { from: `${y}-01-01`, to: today }
  if (kind === 'month') return { from: `${today.slice(0, 7)}-01`, to: today }
  const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate()
  const mm = String(pm).padStart(2, '0')
  return { from: `${py}-${mm}-01`, to: `${py}-${mm}-${last}` }
}

// «Почему отменён?» — без причины сервер не отменит; причина видна в «Истории», у
// менеджера на доске и в карточке (владелец 01.10). null — передумал отменять.
export async function askCancelReason(): Promise<string | null> {
  let text = 'Коротко: клиент передумал, не дозвонились, перенёс на потом…'
  for (;;) {
    const v = await promptDialog({ title: 'Почему отменён?', text, placeholder: 'Клиент передумал', confirmLabel: 'Отменить замер', multiline: true })
    if (v === null) return null
    if (v.trim()) return v.trim()
    text = 'Нужна причина — без неё замер не отменится.'
  }
}
