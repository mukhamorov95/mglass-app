// Прогон светофора заявки (этап В3) на обезличенных текстах настоящих чатов GLASMEN.
// Запуск: npx tsx --tsconfig tsconfig.json scripts/avito-b2b/triage-check.ts
// Числа считает код и без модели; с ключом добавляется сегмент — мнение модели.
// Имён, адресов и ссылок на переписку здесь нет: только то, что клиент просит сделать.
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import Anthropic from '@anthropic-ai/sdk'
import { buildTriage, triageLine, STARTER_THRESHOLDS } from '@/lib/b2b/inquiryTriage'
import { readInquirySegment, INQUIRY_SEGMENT_MODEL } from '@/lib/ai-tools/inquirySegment'

function findEnv(): string | null {
  let dir = resolve('.')
  for (;;) {
    const p = join(dir, '.env.local')
    if (existsSync(p)) return p
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}
const envPath = findEnv()
if (envPath) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}

const CHATS: [string, string][] = [
  ['партия с отверстиями', 'В таких стёклах нужно просверлить отверстие внизу, так же как сверху. 224 шт'],
  ['короткий вопрос', 'Добрый день. стекло 4мм режете?'],
  ['подрезка полок', 'Сколько будет стоить подрезка 3 стеклянных полок?'],
  ['ограждение лестницы', 'Нужна замена треснувшего стекла в ограждении лестницы (обрамление проема). Нужен точный замер, изготовление, доставка и монтаж под ключ. Размер примерно: 1000 × 500 мм. Толщина: 8 мм обычное стекло с полировкой кромки / еврокромкой. Стекло с поручнем.'],
  ['три стекла', 'Здраствуйте 142.5 на 53 1шт 142.5 на 57 1ш т 102 на 57 1шт Нужно 3 стекла Скажите стоимость и где забирать?'],
  ['матовые двери', 'У вас есть матовые стекла на двери? Межкомнатные'],
  ['зеркала по кругу', 'Добрый день подскажите пожалуйста сколько будет стоить изготовление 10 зеркал диаметром 139мм. Толщина 1.5мм'],
  ['нарезка по списку', 'Сколько будет стоить нарезка стекла следующих размеров: Полки (9шт) 768х150мм. Дверки (2шт) 1413х380мм. Никакая фурнитура не требуется.'],
]

const key = process.env.ANTHROPIC_API_KEY
const anthropic = key ? new Anthropic({ apiKey: key }) : null
console.log(`Пороги: партия от ${STARTER_THRESHOLDS.batchFrom} шт, крупное от ${STARTER_THRESHOLDS.largeFrom} шт (стартовые)`)
console.log(anthropic ? `Сегмент: ${INQUIRY_SEGMENT_MODEL}` : 'Сегмент: без ключа — только числа\n')

async function main() {
  for (const [name, text] of CHATS) {
    let opinion = null
    let err = ''
    if (anthropic) {
      const r = await readInquirySegment(anthropic, text)
      if (r.ok) opinion = r.opinion
      else {
        err = r.error
        if (r.fatal) { console.error(`\nОстановка: ${err}`); break }
      }
    }
    const t = buildTriage(text, opinion)
    console.log(`\n${name}`)
    console.log(`  ${triageLine(t)}`)
    console.log(`  числа: units=${t.units ?? '—'} размеров=${t.sizesCount} макс.сторона=${t.maxSideMm ?? '—'} мм · ${t.reason}`)
    if (opinion?.note) console.log(`  модель: ${opinion.note}`)
    if (err) console.log(`  ошибка сегмента: ${err}`)
  }
}

main()
