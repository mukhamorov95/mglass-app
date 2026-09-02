#!/usr/bin/env node
// Импорт готовой озвучки в формат студии.
//
// narrate.mjs синтезирует голосом macOS. Этот скрипт берёт УЖЕ готовые аудиофайлы —
// откуда угодно: ElevenLabs, локальный Qwen3-TTS, запись живого человека — приводит
// их к m4a и собирает тот же manifest.json. Студии всё равно, кто говорил; ей нужны
// файл и длительность.
//
// Использование:
//   node scripts/narrate-import.mjs script.json audioDir public/narration/имя
//
// script.json — массив { id, text }. В audioDir лежат файлы, названные либо по id
// (a01.mp3), либо по порядковому номеру слайда с нуля (00.mp3). Расширение любое,
// что понимает afconvert: mp3, wav, m4a, aiff.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, extname, basename } from 'node:path'

const [scriptPath, audioDir, outDir] = process.argv.slice(2)
if (!scriptPath || !audioDir || !outDir) {
  console.error('Использование: node scripts/narrate-import.mjs <script.json> <audioDir> <outDir>')
  process.exit(1)
}

// Длительность спрашиваем у файла, а не считаем из размера — на mp3 переменного
// битрейта арифметика по байтам врёт ещё сильнее, чем врала на моно-aiff.
function durationSeconds(path) {
  const out = execFileSync('afinfo', [path]).toString()
  const m = out.match(/estimated duration:\s*([\d.]+)\s*sec/)
  if (!m) throw new Error(`afinfo не отдал длительность для ${path}:\n${out}`)
  return Math.round(Number(m[1]) * 10) / 10
}

const slides  = JSON.parse(readFileSync(scriptPath, 'utf8'))
const present = readdirSync(audioDir).filter(f => !f.startsWith('.'))
mkdirSync(outDir, { recursive: true })

// Ищем файл слайда по id, затем по порядковому номеру. Молча пропускаем слайд,
// для которого озвучки нет, но в конце говорим, каких именно не хватило: беззвучный
// кусок в готовом ролике заметить труднее, чем строку в логе.
const manifest = []
const missing  = []
for (const [i, s] of slides.entries()) {
  const byId  = present.find(f => basename(f, extname(f)) === s.id)
  const byNum = present.find(f => basename(f, extname(f)) === String(i).padStart(2, '0'))
  const src   = byId || byNum
  if (!src) { missing.push(`${s.id} (#${i})`); continue }

  const m4a = join(outDir, `${s.id}.m4a`)
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', join(audioDir, src), m4a])
  const seconds = durationSeconds(m4a)
  manifest.push({ id: s.id, seconds, chars: (s.text || '').length, source: src })
  console.log(`  ${s.id}  ${seconds}s  ← ${src}`)
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
const total = manifest.reduce((a, b) => a + b.seconds, 0)
console.log(`\nсобрано ${manifest.length} из ${slides.length}, всего ${total.toFixed(1)} с (${Math.round(total / 60)} мин)`)
if (missing.length) console.log(`БЕЗ ОЗВУЧКИ: ${missing.join(', ')}`)
