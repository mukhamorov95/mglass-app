// Лента действий человека за день: что именно он делал, от первого действия до последнего.
// Список строится тем же правилом isOwnAction, что и счётчик «Действий» в таблице, — иначе
// число и список разойдутся, и владелец перестанет верить обоим.

import { callKind, isOwnAction, type AmoActivityEvent, type AmoCallNote } from '@/lib/amoActivity'

export type TimelineItem = {
  at: number
  kind: string          // машинный тип события amo — для отладки и иконки
  title: string         // что сделал, по-русски
  detail: string        // подробность: текст заметки, этап, длительность звонка
  entity: string | null // на какой карточке
  url: string | null
}

export type EntityName = { name: string; url: string | null }

type Ctx = {
  notesById: Map<number, AmoCallNote & { params?: { text?: string; duration?: number; call_status?: number | null } | null; note_type?: string | number }>
  names: Map<string, EntityName>      // `${entity_type}:${entity_id}` → имя и ссылка
  stageNames: Map<string, string>     // `${pipeline}:${status}` → «Воронка → Этап»
  users: Map<number, string>
  fieldNames: Map<number, string>
}

const dur = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
const ORIGIN: Record<string, string> = {
  avito: 'Avito', 'com.wazzup24.wz': 'WhatsApp', 'com.wazzup24-1': 'WhatsApp', 'com.wazzup24.max': 'MAX',
  instagram_business: 'Instagram', telegram: 'Telegram',
}

type EventValue = {
  note?: { id: number }
  message?: { talk_id?: number; origin?: string }
  lead_status?: { id: number; pipeline_id: number }
  responsible_user?: { id: number }
  custom_field_value?: { field_id?: number; text?: string; enum_id?: number }
  tag?: { name?: string }
  name?: string
}
type Ev = AmoActivityEvent & { value_after?: EventValue[] | null; value_before?: EventValue[] | null }

function describe(e: Ev, ctx: Ctx): { title: string; detail: string } {
  const after = e.value_after?.[0]
  const before = e.value_before?.[0]
  const stage = (v?: EventValue) => (v?.lead_status ? ctx.stageNames.get(`${v.lead_status.pipeline_id}:${v.lead_status.id}`) ?? `этап ${v.lead_status.id}` : null)
  const note = after?.note ? ctx.notesById.get(after.note.id) : undefined

  switch (e.type) {
    case 'outgoing_chat_message':
      return { title: 'Написал клиенту', detail: ORIGIN[after?.message?.origin ?? ''] ?? after?.message?.origin ?? '' }
    case 'outgoing_call': {
      const ok = note ? callKind(note as AmoCallNote) === 'out_ok' : null
      return { title: 'Позвонил клиенту', detail: note ? (ok ? `разговор ${dur(note.params?.duration ?? 0)}` : 'не дозвонился') : '' }
    }
    case 'incoming_call':
      return { title: 'Принял входящий звонок', detail: note ? `разговор ${dur(note.params?.duration ?? 0)}` : '' }
    case 'lead_status_changed': {
      const from = stage(before), to = stage(after)
      return { title: 'Передвинул сделку', detail: from && to ? `${from} → ${to}` : to ?? '' }
    }
    case 'task_added': return { title: 'Поставил задачу', detail: '' }
    case 'task_completed': return { title: 'Закрыл задачу', detail: '' }
    case 'task_deadline_changed': return { title: 'Перенёс срок задачи', detail: '' }
    case 'task_text_changed': return { title: 'Изменил текст задачи', detail: '' }
    case 'task_result_added': return { title: 'Записал результат задачи', detail: '' }
    case 'task_deleted': return { title: 'Удалил задачу', detail: '' }
    case 'common_note_added': return { title: 'Написал заметку', detail: (note?.params?.text ?? '').slice(0, 160) }
    case 'entity_responsible_changed':
      return { title: 'Передал карточку', detail: after?.responsible_user ? `→ ${ctx.users.get(after.responsible_user.id) ?? 'другому'}` : '' }
    case 'entity_tag_added': return { title: 'Поставил тег', detail: after?.tag?.name ?? '' }
    case 'entity_tag_deleted': return { title: 'Снял тег', detail: after?.tag?.name ?? '' }
    case 'name_field_changed': return { title: 'Переименовал карточку', detail: '' }
    case 'lead_added': return { title: 'Завёл сделку', detail: '' }
    case 'lead_deleted': return { title: 'Удалил сделку', detail: '' }
    case 'contact_added': return { title: 'Завёл контакт', detail: '' }
    case 'contact_deleted': return { title: 'Удалил контакт', detail: '' }
    case 'sale_field_changed': return { title: 'Изменил бюджет сделки', detail: '' }
    case 'entity_direct_message': return { title: 'Написал коллеге в карточке', detail: '' }
    case 'talk_closed': return { title: 'Закрыл беседу', detail: '' }
    default:
      if (e.type.startsWith('custom_field')) {
        const id = after?.custom_field_value?.field_id
        const value = after?.custom_field_value?.text ?? ''
        return { title: `Заполнил поле${id && ctx.fieldNames.get(id) ? ` «${ctx.fieldNames.get(id)}»` : ''}`, detail: value.slice(0, 80) }
      }
      return { title: e.type, detail: '' }
  }
}

export function buildTimeline(input: {
  events: Ev[]
  userId: number
  from: number
  to: number
  callNotes: AmoCallNote[]
  missedNoteIds: Set<number>
  names: Map<string, EntityName>
  stageNames: Map<string, string>
  users: Map<number, string>
  fieldNames?: Map<number, string>
  notesById?: Ctx['notesById']
}): TimelineItem[] {
  const ctx: Ctx = {
    notesById: input.notesById ?? new Map(input.callNotes.map(n => [n.id, n])),
    names: input.names,
    stageNames: input.stageNames,
    users: input.users,
    fieldNames: input.fieldNames ?? new Map(),
  }
  return input.events
    .filter(e => e.created_by === input.userId && e.created_at >= input.from && e.created_at < input.to)
    .filter(e => isOwnAction(e, input.missedNoteIds))
    .sort((a, b) => a.created_at - b.created_at)
    .map(e => {
      const { title, detail } = describe(e, ctx)
      const key = `${e.entity_type}:${e.entity_id}`
      const ent = ctx.names.get(key)
      return { at: e.created_at, kind: e.type, title, detail, entity: ent?.name ?? null, url: ent?.url ?? null }
    })
}
