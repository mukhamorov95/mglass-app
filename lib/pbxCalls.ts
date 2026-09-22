// Журнал звонков АТС onlinePBX: что amo не видит. amo знает только звонки, привязанные
// к карточке; пропущенный звонок с нового номера на общую линию в amo не попадает вовсе
// («Неразобранное» по звонкам за 25.08–21.09 — пусто). Чистые функции — данные
// собирает lib/pbxCallsFetch.ts.

export type PbxCall = {
  uuid: string
  startedAt: number
  direction: 'in' | 'out' | 'local'
  clientPhone: string
  ext: string | null
  talkSec: number
  answered: boolean
}

type Raw = Record<string, unknown>

const first = (r: Raw, keys: string[]) => {
  for (const k of keys) {
    const v = r[k]
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
  }
  return ''
}
const digits = (s: string) => s.replace(/\D/g, '')
const isExt = (s: string) => /^\d{2,5}$/.test(digits(s)) && digits(s).length <= 5

// Имена полей в ответе АТС гуляют между версиями API — берём первое непустое из синонимов.
export function normalizePbxCall(r: Raw): PbxCall | null {
  const uuid = first(r, ['uuid', 'call_id', 'id'])
  const startedAt = Number(first(r, ['start_stamp', 'start', 'date', 'created']))
  if (!uuid || !Number.isFinite(startedAt) || startedAt <= 0) return null
  const caller = first(r, ['caller_id_number', 'caller', 'from', 'src'])
  const dest = first(r, ['destination_number', 'destination', 'to', 'dst'])
  const code = first(r, ['accountcode', 'direction', 'type']).toLowerCase()
  let direction: PbxCall['direction'] =
    /in/.test(code) ? 'in' : /out/.test(code) ? 'out' : /local/.test(code) ? 'local'
      : isExt(caller) && !isExt(dest) ? 'out' : !isExt(caller) && isExt(dest) ? 'in' : 'local'
  if (direction !== 'local' && isExt(caller) && isExt(dest)) direction = 'local'
  const talkSec = Number(first(r, ['user_talk_time', 'billsec', 'talk_time', 'talktime'])) || 0
  const client = direction === 'out' ? dest : caller
  const extRaw = direction === 'out' ? caller : dest
  return {
    uuid,
    startedAt,
    direction,
    clientPhone: digits(client).slice(-10),
    ext: isExt(extRaw) ? digits(extRaw) : null,
    talkSec,
    answered: talkSec > 0,
  }
}

export type PbxSummary = {
  calls: number
  inbound: number
  inboundAnswered: number
  inboundMissed: number
  missedCalledBack2h: number
  missedNeverCalledBack: number
  missedNotCalledBackList: { at: number; phone: string }[]
  notInAmo: number
  byUser: { userId: number | null; ext: string; inboundAnswered: number; outbound: number; outboundAnswered: number; talkSec: number }[]
}

// Перезвонили — это исходящий на тот же номер или принятый входящий с него позже.
export function summarizePbx(calls: PbxCall[], extToUser: Map<string, number>, amoUniqs: Set<string>, to: number): PbxSummary {
  const sorted = [...calls].sort((a, b) => a.startedAt - b.startedAt)
  const external = sorted.filter(c => c.direction !== 'local' && c.clientPhone.length === 10)
  const inbound = external.filter(c => c.direction === 'in')
  const missed = inbound.filter(c => !c.answered)
  const contactAfter = (c: PbxCall) => external.find(x =>
    x.clientPhone === c.clientPhone && x.startedAt > c.startedAt && (x.direction === 'out' || x.answered))
  let cb2h = 0, never = 0
  const list: { at: number; phone: string }[] = []
  for (const m of missed) {
    const next = contactAfter(m)
    if (next && next.startedAt - m.startedAt <= 2 * 3600) cb2h++
    if (!next) { never++; list.push({ at: m.startedAt, phone: m.clientPhone }) }
  }
  const byExt = new Map<string, PbxSummary['byUser'][number]>()
  for (const c of external) {
    if (!c.ext) continue
    const row = byExt.get(c.ext) ?? { userId: extToUser.get(c.ext) ?? null, ext: c.ext, inboundAnswered: 0, outbound: 0, outboundAnswered: 0, talkSec: 0 }
    if (c.direction === 'in' && c.answered) row.inboundAnswered++
    if (c.direction === 'out') { row.outbound++; if (c.answered) row.outboundAnswered++ }
    row.talkSec += c.talkSec
    byExt.set(c.ext, row)
  }
  return {
    calls: external.length,
    inbound: inbound.length,
    inboundAnswered: inbound.length - missed.length,
    inboundMissed: missed.length,
    missedCalledBack2h: cb2h,
    missedNeverCalledBack: never,
    // Свежие пропущенные ещё могут перезвонить — список показываем, но это «ждут», не «потеряны»
    missedNotCalledBackList: list.filter(x => x.at < to).slice(-30).reverse(),
    notInAmo: external.filter(c => c.answered && !amoUniqs.has(c.uuid)).length,
    byUser: [...byExt.values()].sort((a, b) => b.inboundAnswered + b.outbound - a.inboundAnswered - a.outbound),
  }
}

// Внутренний номер менеджера зашит в ссылку на запись в заметке amo:
// …/download_amocrm/<base64 JSON {"f":"7926…","t":"103",…}>_<подпись>/rec.mp3
// У входящего он в «t» (кому), у исходящего — в «f» (от кого); второй — номер клиента.
export function extFromRecordLink(link: string | undefined): string | null {
  const m = link?.match(/download_amocrm\/([A-Za-z0-9+/=_-]+?)_/)
  if (!m) return null
  try {
    const json = JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { f?: unknown; t?: unknown }
    const ext = [json.t, json.f].map(v => String(v ?? '')).find(isExt)
    return ext ? digits(ext) : null
  } catch {
    return null
  }
}
