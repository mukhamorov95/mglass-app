import { normalizePbxCall } from '@/lib/pbxCalls'

export type PbxCallRow = {
  uuid: string
  started_at: string
  direction: 'in' | 'out' | 'local'
  client_phone: string | null
  ext: string | null
  talk_sec: number
  duration_sec: number | null
  answered: boolean
  hangup_cause: string | null
  raw: Record<string, unknown>
}

// Строка звонка для pbx_calls: разбор общий с отчётами (normalizePbxCall), сверху —
// длительность и причина завершения, которые нужны ленте карточки.
export function pbxCallRow(raw: Record<string, unknown>): PbxCallRow | null {
  const c = normalizePbxCall(raw)
  if (!c) return null
  const duration = Number(raw.duration)
  const cause = raw.hangup_cause
  return {
    uuid: c.uuid,
    started_at: new Date(c.startedAt * 1000).toISOString(),
    direction: c.direction,
    client_phone: c.clientPhone || null,
    ext: c.ext,
    talk_sec: c.talkSec,
    duration_sec: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    answered: c.answered,
    hangup_cause: typeof cause === 'string' && cause ? cause : null,
    raw,
  }
}

// Окно выгрузки: от последнего сохранённого звонка с запасом в 2 часа (звонок попадает
// в историю АТС после завершения, длинный разговор — позже начала). После простоя крона
// догоняем не глубже недели; глубже — вручную через ?days=.
export function pbxSyncWindow(lastStartedAt: string | null, nowSec: number, days?: number): { from: number; to: number } {
  if (days && days > 0) return { from: nowSec - Math.min(days, 60) * 86400, to: nowSec }
  const floor = nowSec - 7 * 86400
  const last = lastStartedAt ? Math.floor(Date.parse(lastStartedAt) / 1000) : NaN
  // Пустая таблица — первый запуск: берём 30 дней, чтобы сразу было с чем сверять.
  const from = Number.isFinite(last) ? Math.max(floor, last - 7200) : nowSec - 30 * 86400
  return { from, to: nowSec }
}
