import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { countHoleSignals, logDrawingParse } from '@/lib/ai/parseLog'

// 5-страничный PDF + большой tool-JSON на десятки деталей — дефолтного времени не хватает.
export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Разбор чертежа (PDF или фото от руки) в позиции для B2B-калькулятора.
const SCHEMA = {
  type: 'object' as const,
  properties: {
    is_drawing: { type: 'boolean', description: 'true, если это чертёж/эскиз стеклянных деталей с размерами; false — если файл не про детали (счёт, переписка, фото без размеров)' },
    items: {
      type: 'array',
      description: 'Стеклянные изделия/детали с чертежа. Каждая деталь — отдельный элемент.',
      items: {
        type: 'object',
        properties: {
          label:        { type: 'string', description: 'Наименование/описание детали (напр. «Полка», «Дверь душевой», «Стекло на стол»)' },
          width_mm:     { type: 'number', description: 'Номинальная ширина/длина готовой детали, мм (длина стороны фигуры)' },
          height_mm:    { type: 'number', description: 'Номинальная высота готовой детали, мм' },
          shape:        { type: 'string', description: 'Форма детали: rectangle | parallelogram | trapezoid | triangle | other. Если фигура скошенная/непрямоугольная — не rectangle.' },
          cut_width_mm: { type: 'number', description: 'Ширина ПРЯМОУГОЛЬНОЙ ЗАГОТОВКИ для раскроя (габаритный прямоугольник, в который вписана деталь). Для прямоугольника = width_mm. Для параллелограмма/трапеции = сторона + горизонтальный скос (напр. 1180+615=1795). Для треугольника = габаритная ширина.' },
          cut_height_mm:{ type: 'number', description: 'Высота габаритной заготовки для раскроя, мм (обычно = height_mm; для скошенных по высоте — с учётом скоса).' },
          thickness_mm: { type: 'number', description: 'Толщина, мм (4/5/6/8/10/12) — из подписи детали или заголовка её группы (напр. «4мм», «8мм»). Если не указана — 0' },
          is_mirror:    { type: 'boolean', description: 'true — если деталь ЗЕРКАЛО (подпись «Зеркало»); false — если это СТЕКЛО (подпись «Стекло», «Полка», «Дверь» и т.п.). Смотри подпись рядом с деталью И заголовок группы над ней.' },
          material:     { type: 'string', description: 'ПОЛНЫЙ материал как на чертеже, с типом и названием: «зеркало осветлённое», «стекло осветлённое», «стекло прозрачное», «зеркало бронза», «стекло сатин» и т.п. Тип (зеркало/стекло) + название стекла (осветлённое/прозрачное/бронза/тонированное/сатин/матовое). Бери из подписи детали ИЛИ из заголовка её группы. Пусто только если совсем нет подписи.' },
          quantity:     { type: 'number', description: 'Количество одинаковых деталей (из подписи «3 шт», «1 шт», «x2»). По умолчанию 1' },
          holes:        { type: 'number', description: 'Кол-во ПРОСТЫХ круглых отверстий (сверловка на станке)' },
          cutouts:      { type: 'number', description: 'Кол-во СЛОЖНЫХ вырезов (пазы, «чебурашка», фигурные — разметка + выпил, дорого)' },
          tempering:    { type: 'boolean', description: 'Нужна закалка (закалённое/tempered/каленое)' },
          notes:        { type: 'string', description: 'Особенности: фаска, обработка кромки (полировка/еврокромка), фацет, скругления, пескоструй, плёнка — коротко' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' }, description: 'Что не удалось однозначно распознать / требует уточнения менеджером (нечёткий размер, неясная толщина/материал и т.п.)' },
  },
} as const

const SYS =
  'Ты — опытный технолог-оценщик стекольного производства M-Glass. Тебе дают чертёж или эскиз клиента ' +
  '(может быть аккуратный PDF, а может — фото от руки на бумаге). Задача: извлечь ТОЛЬКО реальные стеклянные ' +
  'детали с их параметрами для просчёта.\n' +
  'Правила:\n' +
  '— Отличай РАЗМЕРЫ ДЕТАЛИ (габариты стекла) от штампа, выносок, адресов, телефонов, пометок — их не бери.\n' +
  '— Размеры приводи в миллиметрах. Если указаны в см/метрах — переведи в мм.\n' +
  '— Каждая отдельная деталь = отдельный элемент items. Если написано «x2», «2 шт» — ставь quantity.\n' +
  '— МАТЕРИАЛ И ТИП — ЧИТАЙ ПОДПИСИ ВНИМАТЕЛЬНО. Рядом с деталью или НАД ГРУППОЙ деталей от руки подписывают материал+толщину: ' +
  '«Зеркало Осветлённое 4мм», «Полки: Стекло Осветлённое 8мм». Подпись-ЗАГОЛОВОК над группой относится КО ВСЕМ деталям под ним/рядом. ' +
  'Всегда заполняй is_mirror (зеркало=true / стекло=false) и material полной строкой «зеркало осветлённое» / «стекло осветлённое» / «стекло прозрачное» и т.п. ' +
  'НЕ путай зеркало со стеклом и не подставляй «прозрачное», если написано «осветлённое». Толщину бери из той же подписи.\n' +
  '— Различай ПРОСТЫЕ отверстия (круглые, сверлятся на станке — быстро) и СЛОЖНЫЕ вырезы (пазы, «чебурашка», ' +
  'фигурные — сначала разметка, потом выпил — долго и дорого). Считай их РАЗДЕЛЬНО (holes vs cutouts).\n' +
  '— ФОРМА И РАСКРОЙ: если деталь НЕ прямоугольная (параллелограмм, трапеция, треугольник, со скошенной стороной), то её вырезают из ГАБАРИТНОГО ПРЯМОУГОЛЬНИКА (сначала режут ровный прямоугольник, потом срезают углы) — расход материала больше. ' +
  'На чертеже такие детали обычно подписаны двумя числами по горизонтали (напр. 1180 и 615): сторона + скос. Тогда cut_width_mm = сторона + скос (1180+615=1795), а width_mm = сторона (1180). ' +
  'Для прямоугольника shape=rectangle и cut_width_mm=width_mm, cut_height_mm=height_mm.\n' +
  '— Толщину и материал бери только если явно есть; иначе thickness_mm=0 и material="".\n' +
  '— МНОГОСТРАНИЧНЫЙ PDF (CAD-деталировка со штампом): обработай ВСЕ страницы, на каждой может быть НЕСКОЛЬКО деталей. ' +
  'Материал и толщина из штампа листа (напр. «Стекло бесцветное М1 8 мм») относятся ко всем деталям этого листа. ' +
  'Номера позиций в штампе (1, 2, 3…) — это отдельные детали; количество каждой смотри в таблице штампа. ' +
  'Такая деталировка — ВСЕГДА чертёж (is_drawing=true), даже если выглядит формально.\n' +
  '— На чертеже от руки распознавай по-максимуму, а сомнительное вынеси в warnings.\n' +
  '— Если файл вообще не чертёж деталей — is_drawing=false и items пустой.'

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // Запуск разбора пишем в лог — и удачный, и любой из отказов. До 02.09.2026
  // записей не было вовсе, и на вопрос «разбор не запускали или запускали и он
  // ничего не нашёл» ответить было нечем.
  const startedAt = Date.now()
  const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? null
  const note = (ok: boolean, extra: Partial<Parameters<typeof logDrawingParse>[0]> = {}) =>
    logDrawingParse({ route: 'ai/parse-drawing', userId: user.id, userName: who,
                      durationMs: Date.now() - startedAt, ok, ...extra })

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) {
    await note(false, { error: 'file required' })
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }
  const fileMeta = { name: file.name, type: file.type, size: file.size }

  const buf = Buffer.from(await file.arrayBuffer())
  const b64 = buf.toString('base64')
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const isPdf = type.includes('pdf') || name.endsWith('.pdf')
  const isImg = type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/.test(name)

  if (!isPdf && !isImg) {
    await note(false, { file: fileMeta, error: 'unsupported' })
    return NextResponse.json({ error: 'unsupported', detail: 'Поддерживаются PDF и изображения (фото чертежа).' }, { status: 415 })
  }

  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: (type && type.startsWith('image/') ? type : 'image/jpeg') as 'image/jpeg', data: b64 } }

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      // 2000 обрезало tool-JSON на многодетальных деталировках (14+ позиций) —
      // API возвращал пустой input, UI видел «не распознан». Запас на ~50 деталей.
      max_tokens: 16000,
      system: SYS,
      tools: [{ name: 'drawing', description: 'Извлечённые с чертежа детали', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'drawing' },
      messages: [{ role: 'user', content: [media, { type: 'text', text: 'Разбери этот чертёж/эскиз в детали для просчёта. Обработай все страницы.' }] }],
    })
    if (msg.stop_reason === 'max_tokens') {
      await note(false, { file: fileMeta, error: 'truncated' })
      return NextResponse.json({ error: 'truncated', detail: 'Слишком много деталей в файле — разбейте PDF на части и загрузите по отдельности.' }, { status: 502 })
    }
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') {
      await note(false, { file: fileMeta, error: 'no_structure' })
      return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    }
    const parsed = tool.input as { items?: unknown }
    const items  = Array.isArray(parsed?.items) ? parsed.items : []
    const sig    = countHoleSignals(items)
    // Разбор, вернувший ноль деталей, — это тоже результат, а не сбой: файл мог
    // оказаться не чертежом. Пишем ok:true и ноль найденного, чтобы «не нашёл»
    // не смешалось с «упал».
    await note(true, { file: fileMeta, itemsFound: items.length,
                       itemsWithHoles: sig.withHoles, itemsWithDiameter: sig.withDiameter })
    return NextResponse.json({ parsed: tool.input })
  } catch (e) {
    const d = e instanceof Error ? e.message : String(e)
    await note(false, { file: fileMeta, error: d.slice(0, 300) })
    return NextResponse.json({ error: 'parse_failed', detail: d.slice(0, 300) }, { status: 502 })
  }
}
