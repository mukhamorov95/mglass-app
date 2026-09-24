import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { downloadFile, getFileUrl } from '@/lib/telegram'

// Вебхук записал строку, файла ещё нет — качаем пачками. Отдельно от вебхука, потому
// что Telegram ждёт ответ секунды и повторяет обновление, если не дождался.
// Крон не проходит middleware — проверяет свой секрет сам.
export const runtime = 'nodejs'
export const maxDuration = 300

const BUCKET = 'montage-media'
// Пачка под добор архива пересылкой: по тридцать штук две тысячи кадров едут сутки.
// Фото качается меньше секунды, в 240 отведённых секунд укладывается пара сотен.
const BATCH  = 200

// Bot API отдаёт файлы только до 20 МБ. Видео с телефона это регулярно превышает —
// такие кадры помечаем too_big и берём потом из экспорта истории, а не гадаем.
const TG_LIMIT = 20 * 1024 * 1024

function extFor(kind: string, url: string): string {
  const fromUrl = url.split('?')[0].split('.').pop()
  if (fromUrl && fromUrl.length <= 4 && /^[a-z0-9]+$/i.test(fromUrl)) return fromUrl.toLowerCase()
  return kind === 'video' ? 'mp4' : 'jpg'
}

export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const sb = createServiceClient()
  const { data, error } = await sb
    .from('montage_media')
    .select('id, tg_file_id, kind, file_size, taken_at')
    .eq('fetch_status', 'pending')
    .order('taken_at', { ascending: true })
    .limit(BATCH)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = data ?? []
  if (rows.length === 0) return NextResponse.json({ ok: true, pending: 0 })

  let stored = 0, tooBig = 0, failed = 0
  const startedAt = Date.now()

  for (const row of rows) {
    // оставляем запас: лучше доделать следующим запуском, чем оборваться на полпути
    if (Date.now() - startedAt > 240_000) break

    if ((row.file_size ?? 0) > TG_LIMIT) {
      await sb.from('montage_media')
        .update({ fetch_status: 'too_big', fetch_error: `${row.file_size} байт > 20 МБ` })
        .eq('id', row.id)
      tooBig++
      continue
    }

    try {
      const url  = await getFileUrl(row.tg_file_id)
      const buf  = await downloadFile(row.tg_file_id)
      const d    = new Date(row.taken_at)
      const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${row.id}.${extFor(row.kind, url)}`

      const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buf, {
        contentType: row.kind === 'video' ? 'video/mp4' : 'image/jpeg',
        upsert: true,
      })
      if (upErr) throw new Error(upErr.message)

      await sb.from('montage_media')
        .update({ storage_path: path, fetch_status: 'stored', fetch_error: null, fetched_at: new Date().toISOString(), file_size: buf.length })
        .eq('id', row.id)
      stored++
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e)
      // Telegram отвечает так же и на «file is too big» — различаем по тексту
      const isBig = /too big/i.test(text)
      await sb.from('montage_media')
        .update({ fetch_status: isBig ? 'too_big' : 'failed', fetch_error: text.slice(0, 300) })
        .eq('id', row.id)
      if (isBig) tooBig++; else failed++
    }
  }

  const { count } = await sb
    .from('montage_media')
    .select('id', { count: 'exact', head: true })
    .eq('fetch_status', 'pending')

  return NextResponse.json({ ok: true, stored, tooBig, failed, pendingLeft: count ?? 0 })
}
