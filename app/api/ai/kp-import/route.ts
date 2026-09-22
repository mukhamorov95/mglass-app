import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { reconcileKp } from '@/lib/kpReconcile'
import { KP_SCHEMA } from '@/lib/kp/schema'
import { kpImportWarnings, kpReconcileNotes } from '@/lib/kp/importCheck'
import { createServiceClient } from '@/lib/supabase-service'
import { safeFileName, sourcePath } from '@/lib/kp/sourceFile'
import { randomUUID } from 'crypto'

// Старое КП (PDF или фото) → наша структура. Владелец: «делал КП пять месяцев
// назад, хочу подгрузить, отредактировать под нас, сохранить и отправить».
// Читаем документ как есть, ничего не досочиняя: расхождения показываем словами.
export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MODEL = 'claude-opus-5'
const FALLBACK_MODEL = 'claude-opus-4-8'

const SYS = [
  'Ты помощник менеджера стекольной компании M-Glass. Тебе дают СТАРОЕ коммерческое',
  'предложение (PDF или фото) — оно сделано по чужой структуре, в другом шаблоне.',
  'Задача: перенести его содержимое в нашу структуру КП, ничего не придумывая.',
  'Бери ТОЛЬКО то, что есть в документе. СТРОГО ЗАПРЕЩЕНО добавлять от себя названия',
  'линеек/коллекций/брендов, маркетинговые эпитеты, эмодзи, а также цены, сроки и',
  'гарантии, которых в файле нет — пустое поле лучше выдуманного.',
  'Цены и суммы переноси ровно как в документе, числом (без пробелов и «₽»);',
  'ничего не пересчитывай, не индексируй и не округляй — цены мог менять только человек.',
  'Каждая позиция сметы — отдельная строка со своим количеством, ценой и суммой.',
  'Услуги (монтаж, доставка, подъём, демонтаж) — тоже строки, не вписывай их в изделие.',
  'Если в документе есть скидка — отдельной строкой с отрицательной суммой.',
  'Если сумма строк не сходится с итогом документа — оставь и то и другое как в файле,',
  'НЕ подгоняй: расхождение покажут менеджеру отдельно.',
  'Характеристики изделия (габариты, стекло, толщина, фурнитура, цвет) клади в spec.',
  'Телефон и имя клиента переноси, если они в документе есть.',
].join(' ')

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const fd = await req.formData().catch(() => null)
  const file = fd?.get('file')
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }

  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const isPdf = type.includes('pdf') || name.endsWith('.pdf')
  const isImg = type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)
  if (!isPdf && !isImg) {
    return NextResponse.json({
      error: 'unsupported',
      detail: 'Поддерживаются PDF и фото. Word или Excel — сохраните в PDF (Файл → Сохранить как → PDF) или вставьте текст в поле для расшифровки.',
    }, { status: 415 })
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'too_large', detail: 'Файл больше 20 МБ — сожмите или разбейте на части.' }, { status: 413 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  const b64 = bytes.toString('base64')

  // Файл кладём в приватный бакет ДО разбора: владелец просил, чтобы исходник
  // хранился вместе с КП — иначе через месяц не проверить, откуда взялась цифра.
  // Путь начинается с id загрузившего: пока КП не сохранено, ссылку открывает
  // только он. Не залилось — не повод терять разбор, скажем об этом замечанием.
  const svc = createServiceClient()
  const path = sourcePath(user.id, file.name, randomUUID())
  const up = await svc.storage.from('kp-sources')
    .upload(path, bytes, { contentType: type || 'application/octet-stream', upsert: false })
  const stored = !up.error
  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (type.startsWith('image/') ? type : 'image/jpeg') as 'image/jpeg', data: b64 } }

  const ask = async (model: string) => anthropic.messages.create({
    model,
    max_tokens: 8000,
    system: SYS,
    tools: [{ name: 'kp', description: 'Структура коммерческого предложения', input_schema: KP_SCHEMA }],
    tool_choice: { type: 'tool', name: 'kp' },
    messages: [{ role: 'user', content: [media, { type: 'text', text: 'Перенеси это КП в нашу структуру. Обработай все страницы.' }] }],
  })

  try {
    let msg
    try {
      msg = await ask(MODEL)
    } catch (e) {
      // Модель может быть недоступна ключу — тогда работаем на той, что уже
      // используется в остальных разборах, а не падаем в лицо менеджеру.
      const m = e instanceof Error ? e.message : String(e)
      if (!/model|not_found|404/i.test(m)) throw e
      msg = await ask(FALLBACK_MODEL)
    }
    if (msg.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: 'truncated', detail: 'КП слишком большое — загрузите по частям.' }, { status: 502 })
    }
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })

    // reconcileKp правит структуру на месте — снимок «как прочиталось» нужен до него,
    // иначе не сказать менеджеру, какие числа пришли из файла, а какие поставили мы.
    const raw = structuredClone(tool.input) as Record<string, unknown>
    const kp = reconcileKp(tool.input as Record<string, unknown>)
    const warnings = [...kpReconcileNotes(raw, kp), ...kpImportWarnings(kp)]
    if (!stored) warnings.push('Файл не сохранился в хранилище — КП разобрано, но исходник к нему не приложится.')
    const source = stored ? { path, name: safeFileName(file.name), size: file.size, type } : null
    return NextResponse.json({ kp, warnings, source })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'import_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
