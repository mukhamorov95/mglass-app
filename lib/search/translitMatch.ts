// Поиск по названиям в обоих алфавитах (просьба владельца 07.10): «шо» находит Shower Glass,
// «гласс» — M GLASS, «артур» — Arthur. Обе строки сводятся к одному «звуковому» ключу на
// латинице, совпадение ищется по ключу: начало названия, начало слова, подстрока.

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'u', я: 'a',
}

export function soundKey(s: string | null | undefined): string {
  if (!s) return ''
  // NFKD раскладывает «й» на «и» + знак и «ё» на «е» + знак — знаки снимаем.
  let t = s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  t = Array.from(t, ch => CYR[ch] ?? ch).join('')
  t = t.replace(/[^a-z0-9]+/g, ' ')
  t = t
    .replace(/sch/g, 'sh').replace(/tch/g, 'ch').replace(/ph/g, 'f').replace(/th/g, 't')
    .replace(/kh/g, 'h').replace(/ck/g, 'k')
    .replace(/ch/g, '\u0001').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/\u0001/g, 'ch')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/w/g, 'v').replace(/j/g, 'dzh')
    // «Yandex» = «Яндекс», «Yuri» = «Юрий»: йотированная гласная — та же гласная.
    .replace(/y(?=[aeiou])/g, '').replace(/y/g, 'i')
    .replace(/([a-z])\1+/g, '$1')
  return t.replace(/\s+/g, ' ').trim()
}

// 0 — не подходит; больше — лучше. Цифры (ИНН, телефон) ищутся как цифры.
export function matchScore(query: string, fields: (string | null | undefined)[]): number {
  const q = query.trim()
  if (!q) return 1
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 3 && digits.length === q.replace(/[\s()+-]/g, '').length) {
    return fields.some(f => (f ?? '').replace(/\D/g, '').includes(digits)) ? 2 : 0
  }
  const qk = soundKey(q)
  if (!qk) return 0
  const qc = qk.replace(/ /g, '')
  let best = 0
  fields.forEach((f, i) => {
    const k = soundKey(f)
    if (!k) return
    const kc = k.replace(/ /g, '')
    // Первое поле — само название: при равном совпадении оно выше юрлица или контакта.
    const bonus = i === 0 ? 0.5 : 0
    let s = 0
    if (kc.startsWith(qc)) s = 4
    else if (k.split(' ').some(w => w.startsWith(qk) || w.startsWith(qc))) s = 3
    else if (kc.includes(qc)) s = 2
    if (s) best = Math.max(best, s + bonus)
  })
  return best
}

// Отбор и порядок: лучшее совпадение выше, при равном — исходный порядок (по обороту).
export function searchByName<T>(items: T[], query: string, fields: (item: T) => (string | null | undefined)[], limit = 50): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item, idx) => ({ item, idx, score: matchScore(query, fields(item)) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map(x => x.item)
}
