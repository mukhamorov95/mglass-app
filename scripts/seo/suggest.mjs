// Сбор реальных формулировок запросов из подсказок Яндекса и Google.
// Подсказки — не частотность, а то, что люди действительно набирают: список строится
// по живому вводу, а не по нашим догадкам о том, как называется товар.
// Частотность берётся отдельно в Вордстате (нужен аккаунт), здесь её нет.

import { pathToFileURL } from 'node:url'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36'

async function ask(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ru-RU,ru' } })
    if (!r.ok) return []
    const j = JSON.parse(await r.text())
    // обе выдачи — [запрос, [подсказки...]]
    return Array.isArray(j?.[1]) ? j[1].filter(s => typeof s === 'string') : []
  } catch { return [] }
}

const yandex = q => ask(`https://suggest.yandex.ru/suggest-ff.cgi?part=${encodeURIComponent(q)}&uil=ru&v=4&sn=10`)
const google = q => ask(`https://suggestqueries.google.com/complete/search?client=firefox&hl=ru&gl=ru&q=${encodeURIComponent(q)}`)

// Вопросительные слова вытаскивают именно вопросы — под них пишутся статьи,
// а не карточки товара.
const QUESTIONS = ['как', 'какой', 'какое', 'чем', 'почему', 'сколько', 'что', 'нужно ли', 'можно ли', 'зачем']
const ALPHABET  = 'абвгдежзиклмнопрстуфхцчшэюя'.split('')

export async function harvest(seed, { deep = true } = {}) {
  const out = new Set()
  const probes = [seed]
  if (deep) {
    for (const w of QUESTIONS) probes.push(`${w} ${seed}`)
    for (const c of ALPHABET)  probes.push(`${seed} ${c}`)
  }
  for (const p of probes) {
    const [y, g] = await Promise.all([yandex(p), google(p)])
    for (const s of [...y, ...g]) {
      const t = s.trim().toLowerCase()
      // мусор подсказок: одно слово, чужие бренды-маркетплейсы, «своими руками»
      if (t.length < 8 || t.split(' ').length < 2) continue
      out.add(t)
    }
    await new Promise(r => setTimeout(r, 120))
  }
  return [...out]
}

// \b считает границей только ASCII-символы, поэтому после кириллического слова он не
// срабатывает и все вопросы уезжали в «не вопрос». Границу задаём пробелом явно.
export function isQuestion(q) {
  return /^(как|какой|какая|какое|какие|чем|почему|сколько|что|нужно ли|можно ли|зачем|где|когда|кто|стоит ли|в чем|в чём)\s/.test(q)
}

// Запросы, по которым к нам не придут: чужие площадки, самоделки, готовый ширпотреб.
const JUNK = /озон|ozon|вайлдберриз|wildberries|авито|леруа|икеа|ikea|хофф|hoff|борк|bork|сантехника-?онлайн|castorama|оби |своими руками|бесплатно|б\/у|алиэкспресс|сделать самому|чертеж|выкройка|для авто|автомобил|заднего вида|телефон|андроид|игра|сон|сниться|примета|фэн|фен-?шуй|гадан|магия|разбилось|разбить|на батарейках|настольное|карманное|дорожное/i
export function isJunk(q) { return JUNK.test(q) }

// Путь репозитория содержит кириллицу: import.meta.url приходит процентно-кодированным,
// а process.argv[1] — нет, и обычная проверка «запущен напрямую» молча не срабатывает.
// argv[1] пуст при `node -e` и при импорте из другого модуля — без проверки
// pathToFileURL бросает, и модуль нельзя даже импортировать.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const seeds = process.argv.slice(2)
  if (!seeds.length) { console.log('укажите семена: node scripts/seo/suggest.mjs "зеркало с подсветкой" ...'); process.exit(0) }
  const all = new Map()
  for (const seed of seeds) {
    const got = await harvest(seed)
    for (const q of got) if (!isJunk(q)) all.set(q, seed)
    console.error(`${seed} → ${got.length} (после чистки всего ${all.size})`)
  }
  const rows = [...all.entries()].map(([q, seed]) => ({ q, seed, question: isQuestion(q) }))
  rows.sort((a, b) => Number(b.question) - Number(a.question) || a.q.localeCompare(b.q, 'ru'))
  console.log('﻿запрос;семя;вопрос')
  for (const r of rows) console.log(`${r.q};${r.seed};${r.question ? 'да' : ''}`)
}
