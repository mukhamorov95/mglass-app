// Фото и характеристики с сайта Ветро для разделов конструктора (CONSTRUCTOR_ROUTE.md, К0 для Ветро).
// Ссылка у каждой строки прайса уже своя (`…/2087/?oid=4146` — цвет), а страница товара одна на модель
// и несёт фото всех цветов: грузим её один раз и раскладываем фото по строкам через oid. Чужой сайт —
// по одной странице с паузой.
//
//   ENV_FILE=.env.local npx tsx scripts/enrich-vetro-catalog.ts [--limit N] [--retry] [--dry]
//
// --limit — сколько страниц товара обойти; --retry — повторить строки, где страницу уже смотрели и
// фото не нашли (enriched_at есть, фото нет).

import { readFileSync, existsSync } from 'node:fs'

const envPath = process.env.ENV_FILE ?? '.env.local'
if (existsSync(envPath)) for (const l of readFileSync(envPath, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const arg = (k: string) => process.argv.includes(k)
const limitAt = process.argv.indexOf('--limit')
const LIMIT = limitAt > 0 ? Number(process.argv[limitAt + 1]) : Infinity
const PAUSE_MS = 400

type Row = { id: number; supplier: string; article: string; name: string; url: string | null; category: string | null; image_url: string | null; enriched_at: string | null }

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const { catalogGroupOf } = await import('../lib/calc/compositionCatalog')
  const { fetchVetroPage, vetroOfferId, vetroProductUrl, pickSpecs } = await import('../lib/supplier/enrichParse')
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from('supplier_price_rows')
      .select('id,supplier,article,name,url,category,image_url,enriched_at')
      .eq('supplier', 'vetro').eq('active', true).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  const inCatalog = all.filter(r => catalogGroupOf(r))
  const todo = inCatalog.filter(r => r.url && !r.image_url && (arg('--retry') || !r.enriched_at))
  const pages = new Map<string, Row[]>()
  for (const r of todo) {
    const p = vetroProductUrl(r.url!)
    pages.set(p, [...(pages.get(p) ?? []), r])
  }
  const queue = [...pages].slice(0, LIMIT)
  console.log(`в разделах конструктора ${inCatalog.length} строк, без фото к обходу ${todo.length} на ${pages.size} страницах, берём ${queue.length} страниц`)
  if (arg('--dry')) return

  let own = 0, model = 0, missed = 0, dead = 0, failed = 0
  for (const [i, [page, rows]] of queue.entries()) {
    const info = await fetchVetroPage(page)
    // Страница не загрузилась — строки не трогаем: следующий запуск возьмёт их снова.
    if (!info) dead += rows.length
    else for (const r of rows) {
      const ownImage = info.offers.get(vetroOfferId(r.url!))
      const image = ownImage ?? info.image
      const patch = { image_url: image, specs: { ...pickSpecs('', r.name), ...info.specs }, enriched_at: new Date().toISOString() }
      let saved = false
      for (let attempt = 1; attempt <= 3 && !saved; attempt++) {
        try {
          const { error } = await svc.from('supplier_price_rows').update(patch).eq('id', r.id)
          if (error) throw new Error(error.message)
          saved = true
        } catch (e) {
          if (attempt === 3) { failed++; console.error(`${r.article}: не записано — ${(e as Error).message}`) }
          else await new Promise(res => setTimeout(res, 2000 * attempt))
        }
      }
      if (saved) { if (ownImage) own++; else if (image) model++; else missed++ }
    }
    if ((i + 1) % 25 === 0 || i === queue.length - 1) console.log(`${i + 1}/${queue.length} страниц: фото своего цвета ${own}, фото модели ${model}, без фото ${missed}${dead ? `, страница не открылась ${dead}` : ''}${failed ? `, не записано ${failed}` : ''}`)
    await new Promise(res => setTimeout(res, PAUSE_MS))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
