// Фото, ссылка и характеристики с сайта АВ24 для разделов конструктора (CONSTRUCTOR_ROUTE.md, К0).
// То же, что кнопка обогащения в админке (/api/admin/supplier-catalog/enrich), но по всем
// разделам сразу и после каждого нового прайса. Ходим по одной позиции с паузой: чужой сайт.
// Сначала по одной строке на модель — чтобы у каждой карточки быстрее появилось фото.
//
//   ENV_FILE=.env.local npx tsx scripts/enrich-av24-catalog.ts [--limit N] [--retry] [--dry]
//
// --retry — повторить строки, где карточку уже искали и не нашли (enriched_at есть, фото нет).

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
  const { articleBase } = await import('../lib/supplier/colorCode')
  const { fetchProductInfo } = await import('../lib/supplier/enrichParse')
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await svc.from('supplier_price_rows')
      .select('id,supplier,article,name,url,category,image_url,enriched_at')
      .eq('supplier', 'av24').eq('active', true).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    all.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }
  const inCatalog = all.filter(r => catalogGroupOf(r))
  const todo = inCatalog.filter(r => !r.image_url && (arg('--retry') || !r.enriched_at))
  const seen = new Set<string>()
  const first: Row[] = [], rest: Row[] = []
  for (const r of todo) {
    const b = articleBase('av24', r.article)
    ;(seen.has(b) ? rest : first).push(r)
    seen.add(b)
  }
  const queue = [...first, ...rest].slice(0, LIMIT)
  console.log(`в разделах конструктора ${inCatalog.length} строк, без фото к обходу ${todo.length} (моделей ${first.length}), берём ${queue.length}`)
  if (arg('--dry')) return

  let found = 0, missed = 0
  for (const [i, r] of queue.entries()) {
    const info = await fetchProductInfo({ supplier: r.supplier, article: r.article, name: r.name, url: r.url ?? '' })
    const patch = info
      ? { url: info.url, image_url: info.imageUrl, specs: info.specs, enriched_at: new Date().toISOString() }
      : { enriched_at: new Date().toISOString() }
    const { error } = await svc.from('supplier_price_rows').update(patch).eq('id', r.id)
    if (error) throw new Error(`${r.article}: ${error.message}`)
    if (info?.imageUrl) found++; else missed++
    if ((i + 1) % 25 === 0 || i === queue.length - 1) console.log(`${i + 1}/${queue.length}: с фото ${found}, без ${missed}`)
    await new Promise(res => setTimeout(res, PAUSE_MS))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
