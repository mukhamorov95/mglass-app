#!/usr/bin/env node
// Озвучка обучающих роликов. Текст → m4a, локально, без интернета и без оплаты.
//
// Почему так, а не через облачный синтез: ключ OpenAI в проекте есть, но 02.09.2026
// кредиты кончились (429 credit_balance_exhausted), а других ключей нет. macOS несёт
// русский голос Milena и конвертер afconvert из коробки — этого хватает для внутреннего
// обучения, и оно не ломается, когда у кого-то кончается баланс.
//
// Использование:
//   node scripts/narrate.mjs script.json public/narration
// script.json — массив { id, text }. На выходе <id>.m4a рядом и manifest.json
// с длительностью каждого куска: студии нужно знать, сколько держать слайд.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const VOICE = process.env.NARRATE_VOICE || 'Milena'
const RATE  = process.env.NARRATE_RATE  || '180'   // слов в минуту; 180 — спокойный темп

const [scriptPath, outDir] = process.argv.slice(2)
if (!scriptPath || !outDir) {
  console.error('Использование: node scripts/narrate.mjs <script.json> <outDir>')
  process.exit(1)
}

const slides = JSON.parse(readFileSync(scriptPath, 'utf8'))
mkdirSync(outDir, { recursive: true })

const manifest = []
for (const s of slides) {
  if (!s.id || !s.text) { console.error('пропущен слайд без id или text'); continue }
  const aiff = join(outDir, `${s.id}.aiff`)
  const m4a  = join(outDir, `${s.id}.m4a`)
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '-o', aiff, s.text])
  execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a])
  // Длительность из aiff: 2 канала × 2 байта × 22050 Гц — формат, в котором пишет say.
  const bytes = execFileSync('stat', ['-f', '%z', aiff]).toString().trim()
  const seconds = Math.max(1, Math.round((Number(bytes) - 54) / (22050 * 2 * 2) * 10) / 10)
  rmSync(aiff)
  manifest.push({ id: s.id, seconds, chars: s.text.length })
  console.log(`  ${s.id}  ${seconds}s  ${s.text.slice(0, 50)}…`)
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\nготово: ${manifest.length} кусков, всего ${manifest.reduce((a, b) => a + b.seconds, 0).toFixed(1)} с`)
