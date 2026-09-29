// Выборка для проверки глазами: прогоняет каждый k-й кадр экспорта тем же конвейером,
// что и раскладка, и печатает душевые с разбором Opus рядом с тем, что сказал Haiku.
// Нужна после каждой правки промпта: на трёх кадрах промпт «работает» всегда.
//
//   node scripts/montage/calibrate.mjs <папка экспорта> <результат.json> <сколько кадров> [сдвиг]
//
// Сдвиг даёт другую выборку того же размера: проверять правку промпта на тех же кадрах,
// на которых её подбирали, — значит проверять память, а не правило.
import Anthropic from '@anthropic-ai/sdk'
import fs from 'node:fs'
import path from 'node:path'
import { loadEnvLocal } from '../lib/envLocal.mjs'
import { classifyFrame, HAIKU, OPUS } from './classify.mjs'
const [dir, out, nStr, offStr = '0'] = process.argv.slice(2)
const env = loadEnvLocal()
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 6 })
const PRICE = { [HAIKU]: [1, 5], [OPUS]: [5, 25] }
// детерминированная «случайная» выборка по всему скачанному: берём каждый k-й файл
const all = fs.readdirSync(path.join(dir, 'photos')).filter(f => /\.jpe?g$/i.test(f)).sort()
const n = Number(nStr), step = Math.max(1, Math.floor(all.length / n))
const off = Number(offStr) % step
const pick = all.filter((_, i) => i % step === off).slice(0, n)
const res = []; let cost = 0
let next = 0
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < pick.length) {
    const f = pick[next++]
    try {
      const c = await classifyFrame(fs.readFileSync(path.join(dir, 'photos', f)), 'image/jpeg', client)
      for (const k of c?.calls ?? []) cost += k.in / 1e6 * PRICE[k.model][0] + k.out / 1e6 * PRICE[k.model][1]
      res.push({ f, c })
    } catch (e) { res.push({ f, err: e.message }) }
  }
}))
res.sort((a, b) => a.f.localeCompare(b.f))
fs.writeFileSync(out, JSON.stringify(res, null, 1))
const prod = {}; for (const r of res) { const p = r.c?.product ?? 'ошибка'; prod[p] = (prod[p] ?? 0) + 1 }
console.log(`выборка ${pick.length} из ${all.length} скачанных | изделия:`, prod)
console.log(`цена выборки $${cost.toFixed(3)} → $${(cost / pick.length).toFixed(4)} за кадр`)
for (const r of res.filter(r => r.c?.product === 'душевая')) {
  const s = r.c.shower, h = r.c.shower_haiku ?? {}
  const differ = s.opening !== h.opening || s.geometry !== h.geometry
  console.log(`${r.f}  OPUS: ${s.opening} / ${s.geometry}${s.opening === 'раздвижная' ? ' / ' + s.track : ''}${differ ? `   (haiku: ${h.opening} / ${h.geometry})` : ''}`)
}
for (const r of res.filter(r => r.c?.product === 'зеркало')) {
  const m = r.c.mirror ?? {}, h = r.c.mirror_haiku ?? {}
  const differ = m.light !== h.light || m.frame !== h.frame
  console.log(`${r.f}  ЗЕРКАЛО OPUS: ${m.light} / ${m.frame}${differ ? `   (haiku: ${h.light} / ${h.frame})` : ''}`)
}
for (const r of res.filter(r => r.c?.recheck)) console.log(`${r.f}  ПЕРЕПРОВЕРКА → ${r.c.product}`)
