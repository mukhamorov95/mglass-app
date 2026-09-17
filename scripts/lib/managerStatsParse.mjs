// Разбор листа «Аналитика дохода» из управленческой книги владельца.
//
// Лист устроен поперёк: колонки — дни (01.07, 02.07 …), строки — показатели,
// под каждым показателем идут строки менеджеров. Год отдельной колонкой-маркером
// («р.2 024»), перед днями месяца стоит колонка месячного итога.
//
// Имена в этой книге и в книге продаж пишутся по-разному (Саша/Александра,
// Семен/Семён). Приводим к одному виду, иначе два экрана покажут разных людей.

export const METRICS = [
  { key: 'talks', header: 'разговор', label: 'Разговоры' },
  { key: 'measure_assigned', header: 'замер назначен новый', label: 'Замеры назначены' },
  { key: 'measure_done', header: 'замер проведен новый', label: 'Замеры проведены' },
  { key: 'payments', header: 'кол-во оплат (кол-во новых оплат)', label: 'Оплат, шт' },
  { key: 'prepay', header: 'сумма полученных денег предоплаты', label: 'Предоплаты, ₽' },
  { key: 'remainder', header: 'сумма полученных денег остатки', label: 'Остатки, ₽' },
  { key: 'money_total', header: 'сумма полученных денег всего', label: 'Всего денег, ₽' },
]

export const MONEY_METRICS = new Set(['prepay', 'remainder', 'money_total'])

const NAMES = {
  'айжан': 'Айжан',
  'саша': 'Александра',
  'александра': 'Александра',
  'семен': 'Семён',
  'семён': 'Семён',
  'яна': 'Яна',
  'влад': 'Влад',
  'дима': 'Дима',
  'любовь': 'Любовь',
  'алина': 'Алина',
}

export function normalizeManager(raw) {
  const k = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return NAMES[k] ?? null
}

const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

export function parseNumber(raw) {
  const s = String(raw ?? '').replace(/р\.|₽|%| |\s/g, '').replace(',', '.')
  if (!s || s === '-') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

// Колонки-дни. Год берём из колонки-маркера «р.2 026», месяц и число — из подписи.
export function dayColumns(header) {
  const out = []
  let year = null
  header.forEach((raw, i) => {
    const c = String(raw ?? '').trim()
    const y = /^р?\.?\s*(\d{4})$/.exec(c.replace(/ |\s/g, ''))
    if (y && Number(y[1]) >= 2000 && Number(y[1]) < 2100) { year = Number(y[1]); return }
    const d = /^(\d{2})\.(\d{2})$/.exec(c)
    if (d && year) out.push({ i, date: `${year}-${d[2]}-${d[1]}` })
  })
  return out
}

// Строки листа → факты {date, manager, metric, value}. Всё, что внутри блока
// показателя не опознано как менеджер, возвращаем в unknown: новый человек в
// книге не должен потеряться молча.
export function parseManagerStats(rows) {
  const days = dayColumns(rows[0] ?? [])
  const facts = []
  const unknown = new Set()
  let current = null

  for (let r = 1; r < rows.length; r++) {
    const label = norm(rows[r][0])
    if (!label) { current = null; continue }

    const metric = METRICS.find(m => label.startsWith(m.header))
    if (metric) { current = metric; continue }
    if (!current) continue

    const manager = normalizeManager(rows[r][0])
    if (!manager) {
      // «Средний чек», «Конверсия …» и прочие подытоги закрывают блок.
      if (/^(средний чек|конверсия|итого|прогноз)/.test(label)) { current = null; continue }
      unknown.add(`${current.key}: ${rows[r][0].trim()}`)
      continue
    }
    for (const { i, date } of days) {
      const v = parseNumber(rows[r][i])
      if (v) facts.push({ stat_date: date, manager, metric: current.key, value: v })
    }
  }
  return { facts, unknown: [...unknown], days: days.length }
}
