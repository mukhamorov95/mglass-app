import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { classifyFrame, folderFor } from './classify.mjs'
import { readToken, diskInfo, uploadFile, humanSize } from './disk.mjs'

// Раскладывает архив «Монтажей» в дерево папок: изделие → тип → геометрия → трек.
// Дата не отдельная папка, а часть имени файла: иначе получается триста папок-дат
// с двумя файлами внутри, и найти «угловую с одной дверью» невозможно.
//
//   node scripts/montage/sort-to-disk.mjs --from <папка экспорта> --dest <папка Диска> [--limit 100] [--dry]
//
// --limit ставит пробный прогон: сначала сто кадров, смотрим точность и цену,
// потом уже весь архив.

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith('--') ? [[a.slice(2), all[i + 1]?.startsWith('--') === false ? all[i + 1] : true]] : []),
)

if (!args.from || (!args.dest && !args.dry)) {
  console.error('нужно: --from <папка экспорта Telegram> --dest <куда> [--limit N] [--dry]')
  console.error('  --dest «disk:/MGLASS-Монтажи» — прямо на Яндекс.Диск по API')
  console.error('  --dest «/путь/к/папке»        — в локальную папку (например, синхронизируемую)')
  process.exit(1)
}

// Два приёмника: облако по API и обычная папка. Дерево и имена в обоих одинаковые,
// чтобы результат не зависел от того, каким путём владелец дал доступ.
const toDisk = typeof args.dest === 'string' && args.dest.startsWith('disk:')
const token  = toDisk && !args.dry ? readToken() : null
if (token) {
  const info = await diskInfo(token)
  console.log(`Диск на связи: занято ${humanSize(info.used_space)} из ${humanSize(info.total_space)}, свободно ${humanSize(info.total_space - info.used_space)}`)
}

const IMG = /\.(jpe?g|png|webp|heic)$/i
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

// Экспорт Telegram кладёт рядом result.json — из него берём дату и подпись с номером заказа.
// Без него остаются даты файлов, а номера заказов теряются.
function readExportIndex(dir) {
  const jsonPath = path.join(dir, 'result.json')
  if (!fs.existsSync(jsonPath)) return new Map()
  const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const byFile = new Map()
  for (const m of data.messages ?? []) {
    const file = m.photo ?? m.file
    if (!file) continue
    const caption = Array.isArray(m.text)
      ? m.text.map(t => (typeof t === 'string' ? t : t.text)).join('')
      : (m.text ?? '')
    byFile.set(path.normalize(file), {
      date: m.date ? new Date(m.date) : null,
      caption,
      order: (caption.match(/[#№]\s*(\d{3,6}(?:-\d{1,2})?)/) ?? [])[1] ?? null,
      from: m.from ?? null,
    })
  }
  return byFile
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (IMG.test(e.name)) out.push(p)
  }
  return out
}

const pad = n => String(n).padStart(2, '0')
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`

const index  = readExportIndex(args.from)
const files  = walk(args.from)
const limit  = args.limit ? Number(args.limit) : files.length
const chosen = files.slice(0, limit)

console.log(`кадров найдено: ${files.length}, берём: ${chosen.length}${index.size ? `, подписей из result.json: ${index.size}` : ', result.json нет — даты возьмём из файлов'}`)

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const rows = []
let tin = 0, tout = 0, esc = 0, failed = 0
const counter = new Map()

for (const [i, file] of chosen.entries()) {
  const rel  = path.normalize(path.relative(args.from, file))
  const meta = index.get(rel) ?? {}
  const date = meta.date ?? fs.statSync(file).mtime
  const ext  = path.extname(file).slice(1).toLowerCase()

  let c = null
  try {
    c = await classifyFrame(fs.readFileSync(file), MIME[ext] ?? 'image/jpeg', client)
  } catch (e) {
    failed++
    console.error(`  ! ${rel}: ${e.message.slice(0, 90)}`)
  }
  tin += c?.usage?.in ?? 0
  tout += c?.usage?.out ?? 0
  if (c?.escalated) esc++

  const folder = folderFor(c)
  counter.set(folder, (counter.get(folder) ?? 0) + 1)

  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const seq   = String(counter.get(folder)).padStart(3, '0')
  const name  = [stamp, meta.order ?? null, seq].filter(Boolean).join('__') + '.' + ext

  if (!args.dry) {
    if (toDisk) {
      const remote = `${args.dest.replace(/\/$/, '')}/${folder}/${name}`
      try {
        await uploadFile(token, file, remote)
      } catch (e) {
        failed++
        console.error(`  ! не загрузилось ${name}: ${e.message.slice(0, 120)}`)
      }
    } else {
      const target = path.join(args.dest, folder)
      fs.mkdirSync(target, { recursive: true })
      fs.copyFileSync(file, path.join(target, name))
    }
  }

  rows.push([
    path.join(folder, name), stamp, meta.order ?? '', c?.kind ?? '', c?.product ?? '',
    c?.shower?.opening ?? '', c?.shower?.geometry ?? '', c?.shower?.track ?? '',
    c?.mirror?.light ?? '', c?.stage ?? '', (c?.blockers ?? []).join(';'),
    c?.marketing ?? '', c?.confidence ?? '', c?.model ?? '', c?.note ?? '', rel,
  ])

  if ((i + 1) % 25 === 0) console.log(`  разобрано ${i + 1}/${chosen.length}`)
}

// Реестр — чтобы фильтровать в Excel и не гонять модель заново ради того же вопроса
const header = ['файл', 'дата', 'заказ', 'вид кадра', 'изделие', 'открывание', 'геометрия', 'трек',
                'подсветка', 'стадия', 'стоп-признаки', 'маркетинг', 'уверенность', 'модель', 'заметка', 'исходный путь']
const csv = [header, ...rows].map(r => r.map(csvCell).join(';')).join('\n')
if (!args.dry) {
  // BOM — иначе Excel на Маке открывает кириллицу кракозябрами
  const local = path.join(os.tmpdir(), 'реестр.csv')
  fs.writeFileSync(local, '﻿' + csv, 'utf8')
  if (toDisk) {
    await uploadFile(token, local, `${args.dest.replace(/\/$/, '')}/реестр.csv`)
  } else {
    fs.mkdirSync(args.dest, { recursive: true })
    fs.copyFileSync(local, path.join(args.dest, 'реестр.csv'))
  }
}

const cost = tin / 1e6 * 1 + tout / 1e6 * 5
console.log('\nразложено по папкам:')
for (const [f, n] of [...counter.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${f}`)
console.log(`\nне разобралось: ${failed} | эскалаций на Opus: ${esc}`)
console.log(`токенов in/out: ${tin}/${tout} | на Haiku это $${cost.toFixed(3)}`)
if (chosen.length < files.length) {
  console.log(`весь архив (${files.length} кадров) обойдётся примерно в $${(cost / chosen.length * files.length).toFixed(1)}`)
}
