// Сумма прописью (рубли + копейки цифрами) для счетов/договоров.

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять',
  'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать']
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто']
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот']

function triple(n: number, feminine: boolean): string {
  const ones = feminine ? ONES_F : ONES_M
  const h = Math.floor(n / 100), rest = n % 100, t = Math.floor(rest / 10), o = rest % 10
  const parts: string[] = []
  if (h) parts.push(HUNDREDS[h])
  if (rest > 0 && rest < 20) parts.push(ones[rest])
  else { if (t) parts.push(TENS[t]); if (o) parts.push(ones[o]) }
  return parts.join(' ')
}

// forms = [1, 2-4, 5-0]
function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10, n100 = n % 100
  if (n10 === 1 && n100 !== 11) return forms[0]
  if (n10 >= 2 && n10 <= 4 && !(n100 >= 12 && n100 <= 14)) return forms[1]
  return forms[2]
}

function intToWords(num: number, curForms: [string, string, string]): string {
  if (num === 0) return 'ноль ' + curForms[2]
  const chunks: number[] = []
  let n = num
  while (n > 0) { chunks.push(n % 1000); n = Math.floor(n / 1000) }
  const scale: Array<[string, string, string] | null> = [
    null,
    ['тысяча', 'тысячи', 'тысяч'],
    ['миллион', 'миллиона', 'миллионов'],
    ['миллиард', 'миллиарда', 'миллиардов'],
  ]
  const words: string[] = []
  for (let i = chunks.length - 1; i >= 0; i--) {
    const c = chunks[i]
    if (c === 0) continue
    words.push(triple(c, i === 1))       // тысячи — женский род
    if (i >= 1) words.push(plural(c, scale[i]!))
  }
  words.push(plural(chunks[0], curForms))
  return words.join(' ')
}

// «Шесть тысяч восемьсот двадцать пять рублей 60 коп.»
export function rublesInWords(amount: number): string {
  const rub = Math.floor(amount)
  const kop = Math.round((amount - rub) * 100)
  const w = intToWords(rub, ['рубль', 'рубля', 'рублей'])
  const cap = w.charAt(0).toUpperCase() + w.slice(1)
  return `${cap} ${String(kop).padStart(2, '0')} коп.`
}
