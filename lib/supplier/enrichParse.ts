// Разбор карточки товара с сайта поставщика (чистый модуль, без server-only —
// покрывается тестами). Обогащение позиции справочника с сайта поставщика: ссылка на карточку, фото и
// технические характеристики. Нужно, чтобы владелец видел, что именно он ставит в
// комплект, а визуализатор мог брать реальные габариты фурнитуры вместо плейсхолдеров.
// Ветро отдаёт ссылку прямо в прайсе; у АВ24 ссылки нет — ищем карточку по артикулу.

export type ProductInfo = {
  url: string
  imageUrl: string
  specs: Record<string, string>
}

const UA = 'Mozilla/5.0 (compatible; MGlassBot/1.0; internal catalog enrichment)'
const TIMEOUT_MS = 12000

async function getHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return null
    return await res.text()
  } catch { return null }
}

const abs = (src: string, base: string) => {
  if (!src) return ''
  try { return new URL(src, base).toString() } catch { return '' }
}

const decode = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

export function pickImage(html: string, base: string): string {
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
  if (og) return abs(og[1], base)
  // Фолбэк: первая картинка из карточки товара (у обоих поставщиков это /upload/… или /images/…)
  const img = html.match(/<img[^>]+src=["']([^"']*(?:upload|image|product)[^"']*\.(?:jpe?g|png|webp))["']/i)
  return img ? abs(img[1], base) : ''
}

// Характеристики: сначала пары из таблиц/списков, потом размеры из названия
// («30х10х1.5 мм», «длина 2,2 м», «для стекла 8 мм») — их и потребляет 3D.
export function pickSpecs(html: string, name: string): Record<string, string> {
  const specs: Record<string, string> = {}
  const rows = html.match(/<tr[\s\S]{0,400}?<\/tr>/gi) ?? []
  for (const row of rows) {
    const cells = row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)
    if (!cells || cells.length < 2) continue
    const k = decode(cells[0]), v = decode(cells[1])
    if (k && v && k.length < 60 && v.length < 120 && k !== v) specs[k.replace(/:$/, '')] = v
    if (Object.keys(specs).length >= 20) break
  }
  const text = decode(name)
  const section = text.match(/(\d+[хx]\d+(?:[хx][\d.,]+)?)\s*(?:мм)?/i)
  if (section) specs['Сечение'] = `${section[1].replace(/x/i, 'х').replace(/[,.]$/, '')} мм`
  const length = text.replaceAll(',', '.').match(/(?:длина\s*)?(\d+(?:\.\d+)?)\s*м(?![а-яёa-z])/i)
  if (length) specs['Длина'] = `${length[1]} м`
  const glass = text.match(/(?:для\s*)?стекл[ао]\s*(\d+)\s*мм/i)
  if (glass) specs['Под стекло'] = `${glass[1]} мм`
  const angle = text.match(/(\d+)\s*°(?:\s*-\s*(\d+)\s*°)?/)
  if (angle) specs['Угол'] = angle[0]
  return specs
}

// АВ24 не даёт ссылок в прайсе: ищем карточку по артикулу на сайте.
// Берём первую ссылку каталога, в тексте которой встречается артикул без цветового суффикса.
export async function findAv24Url(article: string): Promise<string> {
  const base = article.split('/')[0].trim()          // «FDC-30 SUS304/PSS» → «FDC-30 SUS304»
  const code = base.split(/\s+/)[0]                  // → «FDC-30»
  if (!code) return ''
  // Поиск у АВ24 — путём, а не параметром: /search/FDC-30/. Артикул целиком (со слэшем
  // цвета) страницу не находит, поэтому сначала короткий код.
  const html = (await getHtml(`https://av24.su/search/${encodeURIComponent(code)}/`))
    || (await getHtml(`https://av24.su/search/${encodeURIComponent(base)}/`))
  if (!html) return ''
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, '')
  const needle = norm(code)
  const colour = norm(article.split('/').slice(1).join(''))   // «PSS» → «pss»
  const material = norm(base.split(/\s+/)[1] ?? '')            // «SUS304» / «AL»
  const hrefs = [...html.matchAll(/href=["'](\/[a-z0-9\-%_/]+\/?)["']/gi)].map(m => m[1])
  const hits = [...new Set(hrefs)].filter(h => norm(h).includes(needle) && !norm(h).includes('def'))
  if (hits.length === 0) return ''
  // Тот же цвет, что в артикуле, иначе первый подходящий.
  // Цвет в слаге идёт вплотную к материалу: …-sus304pss, …-albtp. Ищем эту пару,
  // иначе взяли бы карточку другого цвета — с другой ценой и другим фото.
  const exact = colour ? hits.find(h => norm(h).includes(material + colour)) ?? hits.find(h => norm(h).endsWith(colour)) : undefined
  return abs(exact ?? hits[0], 'https://av24.su')
}

export async function fetchProductInfo(row: { supplier: string; article: string; name: string; url: string }): Promise<ProductInfo | null> {
  const url = row.url || (row.supplier === 'av24' ? await findAv24Url(row.article) : '')
  if (!url) return null
  const html = await getHtml(url)
  if (!html) return { url, imageUrl: '', specs: pickSpecs('', row.name) }
  return { url, imageUrl: pickImage(html, url), specs: pickSpecs(html, row.name) }
}
