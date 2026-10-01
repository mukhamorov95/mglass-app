// Сверка ИИ-разбора чертежа душевой с эталоном 0245 (маршрут SHOWROOM_COST_ROUTE, этап Ч2).
// Чертёж — файл клиента, в репозиторий не кладётся; путь передаётся аргументом.
//
//   ENV_FILE=.env.local NODE_PATH=<каталог с заглушкой server-only> npx tsx scripts/drawing-0245-check.ts "<путь к 0245-0 - общий вид.PDF>"
//
// Один вызов модели. Выход 0 — расхождений с эталоном нет, 1 — есть (список печатается).

import { readFileSync, existsSync } from 'node:fs'

const envPath = process.env.ENV_FILE ?? '.env.local'
if (existsSync(envPath)) for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

async function main() {
  const pdf = process.argv[2]
  if (!pdf || !existsSync(pdf)) throw new Error('укажите путь к PDF 0245')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const { parseShowerDrawing } = await import('../lib/ai/showerDrawing')
  const { compareToFixture, drawingToRequest } = await import('../lib/calc/drawingParse')
  const fixture = JSON.parse(readFileSync(new URL('../__tests__/fixtures/configurator/drawing-0245.json', import.meta.url), 'utf8'))

  const t0 = Date.now()
  const r = await parseShowerDrawing(new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }),
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(pdf).toString('base64') } })
  if (!r.ok) { console.error('разбор не удался:', r); process.exit(2) }
  console.log(`модель ${r.model}, ${r.outputTokens} токенов, ${Math.round((Date.now() - t0) / 1000)} с`)
  for (const s of r.parsed.showers) {
    const a = drawingToRequest(s)
    console.log(`\n${a.title}: ${JSON.stringify(a.dims)} цвет=${a.finishId} стекло=${a.glassId} на чертеже=${JSON.stringify(a.drawn)}`)
    for (const e of a.evidence) console.log(`  ${e.field.padEnd(12)} ${e.value.padEnd(34)} ← ${e.evidence}`)
    for (const x of a.stops) console.log(`  ✋ ${x}`)
    for (const x of a.notes) console.log(`  · ${x}`)
  }
  if (r.parsed.warnings?.length) console.log('\nпредупреждения модели:', r.parsed.warnings)
  const diff = compareToFixture(r.parsed, fixture)
  console.log(diff.length ? `\nРАСХОЖДЕНИЯ С ЭТАЛОНОМ (${diff.length}):\n  ${diff.join('\n  ')}` : '\nс эталоном совпало')
  process.exit(diff.length ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
