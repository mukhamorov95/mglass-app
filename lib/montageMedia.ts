import { createServiceClient } from '@/lib/supabase-service'

// Приём кадров из группы «Монтажи». Вебхук только пишет строку: Telegram ждёт ответ
// секунды, а видео на 40 МБ качается дольше. Файл забирает крон montage-media-fetch.

type TgPhoto = { file_id: string; file_unique_id: string; width?: number; height?: number; file_size?: number }
type TgVideo = TgPhoto & { duration?: number; mime_type?: string }

export type TgMessage = {
  message_id: number
  media_group_id?: string
  date: number
  chat: { id: number; type: string; title?: string }
  from?: { first_name?: string; last_name?: string; username?: string }
  caption?: string
  photo?: TgPhoto[]
  video?: TgVideo
  document?: TgVideo & { file_name?: string }
  // У пересланного кадра date — момент пересылки. Настоящая дата съёмки здесь.
  forward_origin?: {
    date?: number
    chat?: { title?: string }
    sender_user?: { first_name?: string; last_name?: string; username?: string }
    sender_user_name?: string
  }
}

// В подписи бригадира: «Время 10:00 Номер заказа #0875-2 Бригада…». Номер — единственное,
// что из подписи потом используется; всё остальное там — адрес, квартира, телефон клиента.
export function parseOrderNumber(caption?: string): string | null {
  if (!caption) return null
  const m = caption.match(/[#№]\s*(\d{3,6}(?:-\d{1,2})?)/)
  return m ? m[1] : null
}

export function senderName(from?: TgMessage['from']): string | null {
  if (!from) return null
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ').trim()
  return name || (from.username ? `@${from.username}` : null)
}

type Candidate = { kind: 'photo' | 'video'; file: TgVideo }

function pickMedia(msg: TgMessage): Candidate | null {
  // photo приходит лесенкой размеров — последний самый крупный
  if (msg.photo?.length) return { kind: 'photo', file: msg.photo[msg.photo.length - 1] }
  if (msg.video) return { kind: 'video', file: msg.video }
  // телефон иногда шлёт снимок файлом «без сжатия» — он приходит документом
  if (msg.document?.mime_type?.startsWith('image/')) return { kind: 'photo', file: msg.document }
  if (msg.document?.mime_type?.startsWith('video/')) return { kind: 'video', file: msg.document }
  return null
}

export async function captureMontageMedia(msg: TgMessage): Promise<'saved' | 'duplicate' | 'no-media' | 'error'> {
  const media = pickMedia(msg)
  if (!media) return 'no-media'

  // Пересылка: дата и автор берутся из оригинала, иначе весь добранный архив
  // ляжет одним днём и с одним отправителем.
  const origin  = msg.forward_origin
  const takenAt = origin?.date ?? msg.date
  const sender  = senderName(origin?.sender_user)
    ?? origin?.sender_user_name
    ?? senderName(msg.from)

  const sb = createServiceClient()
  const { error } = await sb.from('montage_media').insert({
    tg_chat_id:     msg.chat.id,
    tg_chat_title:  origin?.chat?.title ?? msg.chat.title ?? null,
    tg_message_id:  msg.message_id,
    tg_media_group: msg.media_group_id ?? null,
    tg_file_id:     media.file.file_id,
    tg_file_unique: media.file.file_unique_id,
    kind:           media.kind,
    sender,
    caption_raw:    msg.caption ?? null,
    order_number:   parseOrderNumber(msg.caption),
    taken_at:       new Date(takenAt * 1000).toISOString(),
    width:          media.file.width ?? null,
    height:         media.file.height ?? null,
    duration:       media.file.duration ?? null,
    file_size:      media.file.file_size ?? null,
  })

  // один и тот же файл приходит повторно при пересылке — уникальный индекс это ловит
  if (error?.code === '23505') return 'duplicate'
  if (error) {
    console.error('[montage] insert failed:', error.message)
    return 'error'
  }
  return 'saved'
}
