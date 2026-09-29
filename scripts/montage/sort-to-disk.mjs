import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'
import { loadEnvLocal } from '../lib/envLocal.mjs'
import { classifyFrame, buildParams, parseMessage, folderFor, HAIKU, OPUS } from './classify.mjs'
import { readToken, diskInfo, uploadFile, humanSize } from './disk.mjs'

// Раскладка архива «Монтажей» по дереву папок: изделие → тип → геометрия → трек.
//
// Источник правды — таблица montage_media. В неё сходятся оба пути: бот ловит новое,
// экспорт Telegram Desktop приносит историю. Каждый шаг берёт из таблицы только то,
// что ещё не сделано, поэтому прогон можно оборвать и продолжить без повторной оплаты
// разбора и без дублей на Диске.
//
//   node scripts/montage/sort-to-disk.mjs status
//   node scripts/montage/sort-to-disk.mjs ingest   --export <папка экспорта>
//   node scripts/montage/sort-to-disk.mjs classify [--export <папка>] [--limit 100] [--concurrency 4]
//   node scripts/montage/sort-to-disk.mjs classify --batch [--export <папка>] [--limit N]   — пакетом, вдвое дешевле
//   node scripts/montage/sort-to-disk.mjs collect                                          — забрать готовые пакеты
//   node scripts/montage/sort-to-disk.mjs upload   --dest disk:/<папка> [--export <папка>] [--limit N]
//   node scripts/montage/sort-to-disk.mjs registry --dest disk:/<папка>
//   node scripts/montage/sort-to-disk.mjs run      --export <папка> --dest disk:/<папка> [--limit 100]
//   node scripts/montage/sort-to-disk.mjs retry-failed
//
// Сначала --limit 100: смотрим точность и цену на сотне, потом весь архив.

const [cmd, ...rest] = process.argv.slice(2)
const args = Object.fromEntries(
  rest.flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]] : []),
)

const env = loadEnvLocal()
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const BUCKET = 'montage-media'

// $ за миллион токенов, вход/выход. Модель, которой нет в таблице, — предупреждение,
// а не молчаливый ноль: цену прогона владелец решает по этой цифре.
const PRICE = { [HAIKU]: [1, 5], [OPUS]: [5, 25] }
const unknownPrice = new Set()
function costOf(c) {
  if (!c) return 0
  const at = (model, i = 0, o = 0) => {
    const p = PRICE[model]
    if (!p) { unknownPrice.add(model); return 0 }
    return i / 1e6 * p[0] + o / 1e6 * p[1]
  }
  // пакетный вызов Anthropic стоит половину обычного
  if (Array.isArray(c.calls)) return c.calls.reduce((s, k) => s + at(k.model, k.in, k.out) * (k.batch ? 0.5 : 1), 0)
  // записи до 29.09: usage — последний вызов, Haiku эскалированного кадра лежит внутри
  if (!c.usage) return 0
  return at(c.model, c.usage.in, c.usage.out) + (c.usage.haiku ? at(HAIKU, c.usage.haiku.in, c.usage.haiku.out) : 0)
}

// Все строки, а не первую тысячу: Supabase по умолчанию отдаёт не больше 1000.
async function fetchAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...data)
    if (data.length < 1000) return out
  }
}

async function pool(items, n, fn) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const k = next++; await fn(items[k], k) }
  }))
}

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
const extOf = p => (p ?? '').split('?')[0].split('.').pop().toLowerCase()

// ── ingest: экспорт → таблица ────────────────────────────────────────────────

function captionOf(m) {
  if (typeof m.text === 'string') return m.text
  if (Array.isArray(m.text)) return m.text.map(t => (typeof t === 'string' ? t : t.text ?? '')).join('')
  return ''
}

// Что из сообщения экспорта считаем кадром объекта. «(File not included…)» — Telegram
// не скачал файл по настройкам экспорта; стикеры, гифки, кружки и голосовые — не объекты.
function mediaOf(m) {
  const real = v => typeof v === 'string' && !v.startsWith('(')
  if (real(m.photo)) return { kind: 'photo', rel: m.photo, size: m.photo_file_size }
  if (!real(m.file)) return null
  const mime = m.mime_type ?? ''
  if (m.media_type === 'sticker' || m.media_type === 'animation') return null
  if (mime.startsWith('image/')) return { kind: 'photo', rel: m.file, size: m.file_size }
  if (mime.startsWith('video/') && (m.media_type === 'video_file' || !m.media_type)) {
    return { kind: 'video', rel: m.file, size: m.file_size }
  }
  return null
}

async function ingest(dir) {
  const jsonPath = path.join(dir, 'result.json')
  if (!fs.existsSync(jsonPath)) throw new Error(`нет ${jsonPath} — это не папка экспорта в формате JSON`)
  let data
  try {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  } catch {
    // Telegram Desktop пишет result.json по ходу экспорта: оборванный JSON значит «ещё идёт»,
    // и заводить по нему строки — значит потерять всё, что после обрыва.
    throw new Error('result.json не дописан — экспорт ещё идёт. Дождитесь окна «Экспорт завершён» и повторите.')
  }

  // Bot API видит супергруппу как -100<id>, обычную группу как -<id>. По этому id строки
  // экспорта совпадают со строками, которые уже завёл бот.
  const chatId = /supergroup|channel/.test(data.type ?? '') ? Number(`-100${data.id}`) : -Number(data.id)

  const rows = [], skipped = {}, missing = []
  for (const m of data.messages ?? []) {
    if (m.type !== 'message') continue
    const media = mediaOf(m)
    if (!media) {
      const why = m.media_type ?? (m.photo || m.file ? 'файл не выгружен' : null)
      if (why) skipped[why] = (skipped[why] ?? 0) + 1
      continue
    }
    if (!fs.existsSync(path.join(dir, media.rel))) { missing.push(media.rel); continue }
    const caption = captionOf(m)
    rows.push({
      source: 'export',
      tg_chat_id: chatId,
      tg_chat_title: data.name ?? null,
      tg_message_id: m.id,
      kind: media.kind,
      export_path: media.rel,
      sender: m.from ?? null,
      caption_raw: caption || null,
      order_number: (caption.match(/[#№]\s*(\d{3,6}(?:-\d{1,2})?)/) ?? [])[1] ?? null,
      taken_at: new Date(Number(m.date_unixtime) * 1000).toISOString(),
      width: m.width ?? null,
      height: m.height ?? null,
      duration: m.duration_seconds ?? null,
      file_size: media.size ?? null,
      fetch_status: 'stored',
    })
  }

  let added = 0
  for (let i = 0; i < rows.length; i += 500) {
    const { data: ins, error } = await sb.from('montage_media')
      .upsert(rows.slice(i, i + 500), { onConflict: 'tg_chat_id,tg_message_id', ignoreDuplicates: true })
      .select('id')
    if (error) throw new Error(error.message)
    added += ins?.length ?? 0
  }

  console.log(`экспорт «${data.name}»: кадров ${rows.length} (фото ${rows.filter(r => r.kind === 'photo').length}, видео ${rows.filter(r => r.kind === 'video').length})`)
  console.log(`  новых строк: ${added}, уже были (пойманы ботом или прошлым импортом): ${rows.length - added}`)
  if (missing.length) console.log(`  в result.json есть, файла в папке нет: ${missing.length} — например ${missing[0]}`)
  const sk = Object.entries(skipped)
  if (sk.length) console.log(`  пропущено как не-кадры: ${sk.map(([k, v]) => `${k} ${v}`).join(', ')}`)
}

// ── classify ────────────────────────────────────────────────────────────────

async function bytesOf(row, exportDir) {
  if (row.source === 'export') {
    if (!exportDir) return { skip: 'нужен --export, чтобы найти файл' }
    const p = path.join(exportDir, row.export_path)
    if (!fs.existsSync(p)) return { skip: `нет файла ${row.export_path}` }
    return { buf: fs.readFileSync(p), ext: extOf(row.export_path), file: p }
  }
  const { data, error } = await sb.storage.from(BUCKET).download(row.storage_path)
  if (error) return { skip: `хранилище: ${error.message}` }
  return { buf: Buffer.from(await data.arrayBuffer()), ext: extOf(row.storage_path) }
}

// API не принимает HEIC и отклоняет картинки тяжелее 5 МБ, а снимок «без сжатия» с
// телефона бывает и 12 МБ. Уменьшаем копию для разбора; на Диск уходит оригинал.
function forModel(buf, ext) {
  if (MIME[ext] && buf.length < 3.5e6) return { data: buf, mime: MIME[ext] }
  const tag = `${process.pid}-${Math.random().toString(36).slice(2)}`
  const src = path.join(os.tmpdir(), `mm-src-${tag}.${ext || 'bin'}`)
  const dst = path.join(os.tmpdir(), `mm-dst-${tag}.jpg`)
  fs.writeFileSync(src, buf)
  try {
    execFileSync('sips', ['-Z', '1568', '-s', 'format', 'jpeg', src, '--out', dst], { stdio: 'ignore' })
    return { data: fs.readFileSync(dst), mime: 'image/jpeg' }
  } finally {
    fs.rmSync(src, { force: true }); fs.rmSync(dst, { force: true })
  }
}

async function classify({ exportDir, limit, concurrency }) {
  let rows = await fetchAll(() => sb.from('montage_media')
    .select('id, source, export_path, storage_path')
    .eq('kind', 'photo').eq('class_status', 'none').eq('fetch_status', 'stored')
    .order('taken_at', { ascending: true }).order('id'))
  if (limit) rows = rows.slice(0, limit)
  if (!rows.length) { console.log('разбирать нечего — все кадры уже разобраны'); return }

  console.log(`разбираю ${rows.length} кадров, параллельно ${concurrency}`)
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 6 })
  let done = 0, failed = 0, skipped = 0, spent = 0
  const skipReasons = new Map()

  await pool(rows, concurrency, async row => {
    const got = await bytesOf(row, exportDir)
    if (got.skip) {
      skipped++
      skipReasons.set(got.skip.split(' ')[0], got.skip)
      return
    }
    let c = null, err = null
    try {
      const { data, mime } = forModel(got.buf, got.ext)
      c = await classifyFrame(data, mime, client)
      if (!c) err = 'модель ответила не JSON'
    } catch (e) {
      err = (e?.message ?? String(e)).slice(0, 300)
    }
    if (c) {
      spent += costOf(c)
      await sb.from('montage_media').update({ classification: c, class_status: 'done' }).eq('id', row.id)
      done++
    } else {
      await sb.from('montage_media').update({ classification: { error: err }, class_status: 'failed' }).eq('id', row.id)
      failed++
    }
    const n = done + failed
    if (n % 25 === 0) console.log(`  ${n}/${rows.length}  потрачено $${spent.toFixed(3)}`)
  })

  console.log(`\nразобрано ${done}, ошибок ${failed}, пропущено ${skipped}`)
  for (const why of skipReasons.values()) console.log(`  пропуск: ${why}`)
  console.log(`потрачено за прогон: $${spent.toFixed(3)}` + (done ? ` ($${(spent / done).toFixed(4)} за кадр)` : ''))
  if (unknownPrice.size) console.log(`  ! цены нет для: ${[...unknownPrice].join(', ')} — сумма занижена`)

  const { count } = await sb.from('montage_media').select('id', { count: 'exact', head: true })
    .eq('kind', 'photo').eq('class_status', 'none')
  if (count && done) console.log(`осталось ${count} кадров ≈ $${(spent / done * count).toFixed(2)} по цене этого прогона`)
}

// ── пакетный режим ──────────────────────────────────────────────────────────

// Пакет Anthropic — до 256 МБ. Кадры в base64 плюс обвязка; запас — чтобы не упереться
// в предел на последнем кадре пачки и не потерять весь запрос.
const BATCH_BYTES = 180 * 1024 * 1024
const BATCH_COUNT = 5000

async function markRows(ids, patch) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await sb.from('montage_media').update(patch).in('id', ids.slice(i, i + 200))
    if (error) throw new Error(error.message)
  }
}

async function submitBatches({ exportDir, limit }) {
  let rows = await fetchAll(() => sb.from('montage_media')
    .select('id, source, export_path, storage_path')
    .eq('kind', 'photo').eq('class_status', 'none').eq('fetch_status', 'stored')
    .order('taken_at', { ascending: true }).order('id'))
  if (limit) rows = rows.slice(0, limit)
  if (!rows.length) { console.log('отправлять нечего — все кадры разобраны или уже в очереди'); return }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 6 })
  let chunk = [], ids = [], bytes = 0, sent = 0, skipped = 0

  // Строки помечаются «в очереди» ДО создания пакета: если процесс упадёт между созданием
  // и пометкой, повторный запуск иначе отправил бы те же кадры ещё раз и за них заплатили бы
  // дважды. Не создался пакет — пометка снимается.
  async function flush() {
    if (!chunk.length) return
    const local = `local-${Date.now()}`
    await markRows(ids, { class_status: 'queued', class_batch: local })
    let b
    try {
      b = await client.messages.batches.create({ requests: chunk })
    } catch (e) {
      await markRows(ids, { class_status: 'none', class_batch: null })
      throw e
    }
    await markRows(ids, { class_batch: b.id })
    sent += chunk.length
    console.log(`  пакет ${b.id}: ${chunk.length} кадров, ${humanSize(bytes)}`)
    chunk = []; ids = []; bytes = 0
  }

  for (const row of rows) {
    const got = await bytesOf(row, exportDir)
    if (got.skip) { skipped++; continue }
    const { data, mime } = forModel(got.buf, got.ext)
    const size = Math.ceil(data.length * 4 / 3) + 4000
    if (chunk.length && (bytes + size > BATCH_BYTES || chunk.length >= BATCH_COUNT)) await flush()
    chunk.push({ custom_id: row.id, params: buildParams(data, mime) })
    ids.push(row.id)
    bytes += size
  }
  await flush()
  console.log(`\nотправлено ${sent} кадров${skipped ? `, пропущено ${skipped} (нет файла — нужен --export?)` : ''}`)
  console.log('Anthropic разбирает пакеты до суток, обычно быстрее. Забрать готовое: collect')
}

async function collect() {
  const queued = await fetchAll(() => sb.from('montage_media')
    .select('id, class_batch').eq('class_status', 'queued'))
  if (!queued.length) { console.log('в очереди у Anthropic ничего нет'); return }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 6 })
  const batches = [...new Set(queued.map(r => r.class_batch))]
  let done = 0, failed = 0, back = 0, waiting = 0, spent = 0

  for (const id of batches) {
    if (!id || id.startsWith('local-')) {
      // пакет мог уйти, а id не записаться — возвращать в очередь вслепую нельзя, это двойная оплата
      console.log(`  ! ${queued.filter(r => r.class_batch === id).length} строк помечены ${id ?? 'без пакета'}: процесс упал при отправке. Сверьте список пакетов в консоли Anthropic, прежде чем что-то делать.`)
      continue
    }
    const b = await client.messages.batches.retrieve(id)
    if (b.processing_status !== 'ended') {
      const c = b.request_counts
      waiting += c.processing
      console.log(`  пакет ${id}: идёт — готово ${c.succeeded}, в работе ${c.processing}`)
      continue
    }
    const updates = []
    for await (const r of await client.messages.batches.results(id)) {
      if (r.result.type === 'succeeded') {
        const c = parseMessage(r.result.message, { batch: true })
        if (c) { spent += costOf(c); done++; updates.push([r.custom_id, { classification: c, class_status: 'done' }]) }
        else { failed++; updates.push([r.custom_id, { classification: { error: 'модель ответила не JSON' }, class_status: 'failed' }]) }
      } else if (r.result.type === 'errored') {
        failed++
        updates.push([r.custom_id, { classification: { error: JSON.stringify(r.result.error).slice(0, 300) }, class_status: 'failed' }])
      } else {
        // истёк или отменён — Anthropic за него не взял денег, кадр можно отправить снова
        back++
        updates.push([r.custom_id, { class_status: 'none', class_batch: null }])
      }
    }
    await pool(updates, 8, async ([rowId, patch]) => {
      const { error } = await sb.from('montage_media').update(patch).eq('id', rowId)
      if (error) console.error(`  ! ${rowId}: ${error.message}`)
    })
    console.log(`  пакет ${id}: забрал ${updates.length}`)
  }

  console.log(`\nразобрано ${done}, ошибок ${failed}, вернулось в очередь ${back}${waiting ? `, ещё в работе ${waiting}` : ''}`)
  if (done) console.log(`стоимость этих кадров: $${spent.toFixed(2)} ($${(spent / done).toFixed(4)} за кадр)`)
}

// ── upload ──────────────────────────────────────────────────────────────────

// Дата — московская: кадр в 01:30 по UTC снят уже следующим днём. Имя детерминировано
// сообщением, а не порядком прогона: пробный и полный прогон кладут кадр в тот же файл.
function nameOf(row, ext) {
  const stamp = new Date(new Date(row.taken_at).getTime() + 3 * 3600e3).toISOString().slice(0, 10)
  const msg = String(row.tg_message_id).replace('-', 'n')
  return [stamp, row.order_number, msg].filter(Boolean).join('__') + '.' + ext
}

function folderOfVideo(row) {
  const d = new Date(new Date(row.taken_at).getTime() + 3 * 3600e3).toISOString()
  return `06 Видео/${d.slice(0, 4)}/${d.slice(0, 7)}`
}

async function upload({ dest, exportDir, limit }) {
  const toDisk = dest.startsWith('disk:')
  const token = toDisk ? readToken() : null
  if (token) {
    const info = await diskInfo(token)
    console.log(`Диск на связи: свободно ${humanSize(info.total_space - info.used_space)} из ${humanSize(info.total_space)}`)
  }

  // Видео не разбираем: модель смотрит картинки, а кадр из ролика без ffmpeg не вынуть.
  // Они ложатся по датам — всё равно на Диске, как и просили.
  let rows = await fetchAll(() => sb.from('montage_media')
    .select('id, source, kind, export_path, storage_path, classification, taken_at, tg_message_id, order_number, file_size')
    .is('disk_path', null).eq('fetch_status', 'stored')
    .or('and(kind.eq.photo,class_status.eq.done),kind.eq.video')
    .order('taken_at', { ascending: true }).order('id'))
  if (limit) rows = rows.slice(0, limit)
  if (!rows.length) { console.log('выгружать нечего'); return }

  const need = rows.reduce((s, r) => s + (r.file_size ?? 0), 0)
  console.log(`выгружаю ${rows.length} файлов ≈ ${humanSize(need)}`)
  let ok = 0, bad = 0
  const byFolder = new Map()

  for (const [i, row] of rows.entries()) {
    const got = await bytesOf(row, exportDir)
    if (got.skip) { bad++; console.error(`  ! ${got.skip}`); continue }
    const folder = row.kind === 'video' ? folderOfVideo(row) : folderFor(row.classification)
    const rel = `${folder}/${nameOf(row, got.ext)}`
    try {
      if (toDisk) {
        await uploadFile(token, got.file ?? got.buf, `${dest.replace(/\/$/, '')}/${rel}`)
      } else {
        fs.mkdirSync(path.join(dest, folder), { recursive: true })
        fs.writeFileSync(path.join(dest, rel), got.buf)
      }
      await sb.from('montage_media').update({ disk_path: rel }).eq('id', row.id)
      byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1)
      ok++
    } catch (e) {
      bad++
      console.error(`  ! ${rel}: ${(e?.message ?? e).toString().slice(0, 120)}`)
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${rows.length}`)
  }

  console.log(`\nвыгружено ${ok}, не вышло ${bad}`)
  for (const [f, n] of [...byFolder.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${f}`)
}

// ── registry ────────────────────────────────────────────────────────────────

// Реестр строится из таблицы целиком, а не из последнего прогона: после обрыва и
// продолжения в нём должны быть все кадры. Подпись бригадира сюда не идёт — в ней
// адрес, квартира и телефон клиента.
async function registry({ dest }) {
  const rows = await fetchAll(() => sb.from('montage_media')
    .select('disk_path, taken_at, order_number, kind, source, tg_message_id, classification')
    .not('disk_path', 'is', null)
    .order('taken_at', { ascending: true }).order('id'))
  const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const header = ['файл', 'дата', 'заказ', 'тип', 'вид кадра', 'изделие', 'открывание', 'геометрия', 'трек',
    'подсветка', 'стадия', 'стоп-признаки', 'маркетинг', 'уверенность', 'модель', 'заметка', 'источник', 'сообщение']
  const lines = rows.map(r => {
    const c = r.classification ?? {}
    return [r.disk_path, r.taken_at?.slice(0, 10), r.order_number, r.kind, c.kind, c.product,
      c.shower?.opening, c.shower?.geometry, c.shower?.opening === 'раздвижная' ? c.shower?.track : '', c.mirror?.light, c.stage,
      (c.blockers ?? []).join(';'), c.marketing, c.confidence, c.model, c.note, r.source, r.tg_message_id]
  })
  // BOM — иначе Excel на Маке открывает кириллицу кракозябрами
  const csv = '﻿' + [header, ...lines].map(l => l.map(cell).join(';')).join('\n')
  const local = path.join(os.tmpdir(), 'реестр.csv')
  fs.writeFileSync(local, csv, 'utf8')
  if (dest.startsWith('disk:')) await uploadFile(readToken(), local, `${dest.replace(/\/$/, '')}/реестр.csv`)
  else { fs.mkdirSync(dest, { recursive: true }); fs.copyFileSync(local, path.join(dest, 'реестр.csv')) }
  console.log(`реестр: ${rows.length} строк → ${dest}/реестр.csv`)
}

// ── status ──────────────────────────────────────────────────────────────────

async function status() {
  const rows = await fetchAll(() => sb.from('montage_media')
    .select('source, kind, fetch_status, class_status, disk_path, classification'))
  const key = r => `${r.source.padEnd(6)} ${r.kind.padEnd(5)} загрузка:${r.fetch_status.padEnd(7)} разбор:${r.class_status.padEnd(6)} ${r.disk_path ? 'на Диске' : 'не на Диске'}`
  const by = new Map()
  let spent = 0
  for (const r of rows) {
    by.set(key(r), (by.get(key(r)) ?? 0) + 1)
    if (r.class_status === 'done') spent += costOf(r.classification)
  }
  console.log(`всего строк: ${rows.length}`)
  for (const [k, n] of [...by.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`)
  console.log(`на разбор уже потрачено: $${spent.toFixed(2)}`)
  const failed = rows.filter(r => r.class_status === 'failed')
  if (failed.length) {
    const why = new Map()
    for (const r of failed) { const k = (r.classification?.error ?? '?').slice(0, 60); why.set(k, (why.get(k) ?? 0) + 1) }
    console.log(`ошибки разбора (retry-failed вернёт их в очередь):`)
    for (const [k, n] of why) console.log(`  ${n} × ${k}`)
  }
}

// ── main ────────────────────────────────────────────────────────────────────

const exportDir   = typeof args.export === 'string' ? args.export : null
const dest        = typeof args.dest === 'string' ? args.dest : null
const limit       = args.limit ? Number(args.limit) : null
const concurrency = args.concurrency ? Number(args.concurrency) : 4
const needDest = () => { if (!dest) { console.error('нужен --dest disk:/<папка> или --dest /локальная/папка'); process.exit(1) } }

try {
  switch (cmd) {
    case 'status':   await status(); break
    case 'ingest':   if (!exportDir) throw new Error('нужен --export <папка экспорта>'); await ingest(exportDir); break
    case 'classify': if (args.batch) await submitBatches({ exportDir, limit }); else await classify({ exportDir, limit, concurrency }); break
    case 'collect':  await collect(); break
    case 'upload':   needDest(); await upload({ dest, exportDir, limit }); break
    case 'registry': needDest(); await registry({ dest }); break
    case 'retry-failed': {
      const { data } = await sb.from('montage_media').update({ class_status: 'none', classification: null })
        .eq('class_status', 'failed').select('id')
      console.log(`вернул в очередь: ${data?.length ?? 0}`)
      break
    }
    case 'run':
      needDest()
      if (exportDir) await ingest(exportDir)
      await classify({ exportDir, limit, concurrency })
      await upload({ dest, exportDir, limit })
      await registry({ dest })
      await status()
      break
    default:
      console.log('команды: status | ingest | classify [--batch] | collect | upload | registry | run | retry-failed (подробности — в шапке файла)')
  }
} catch (e) {
  console.error(`ERROR: ${e.message}`)
  process.exit(1)
}
