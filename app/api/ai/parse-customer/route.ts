import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Распознавание заказчика для договора из текста ИЛИ карточки предприятия (PDF).
// Claude читает PDF нативно. Возвращает структуру заказчика (физлицо/юрлицо).
const CUSTOMER_SCHEMA = {
  type: 'object' as const,
  properties: {
    customer_type: { type: 'string', enum: ['individual', 'company'], description: 'individual — физлицо (паспорт), company — юрлицо/ИП (ИНН, ОГРН)' },
    // физлицо
    fio:                 { type: 'string', description: 'ФИО полностью' },
    passport_series:     { type: 'string', description: 'Серия паспорта' },
    passport_number:     { type: 'string', description: 'Номер паспорта' },
    passport_issued_by:  { type: 'string', description: 'Кем выдан' },
    passport_issued_date:{ type: 'string', description: 'Дата выдачи ДД.ММ.ГГГГ' },
    passport_code:       { type: 'string', description: 'Код подразделения' },
    // юрлицо
    name:          { type: 'string', description: 'Полное наименование организации (ООО/ИП)' },
    director:      { type: 'string', description: 'В лице кого (директор), в родительном падеже' },
    inn:           { type: 'string', description: 'ИНН' },
    kpp:           { type: 'string', description: 'КПП' },
    ogrn:          { type: 'string', description: 'ОГРН / ОГРНИП' },
    legal_address: { type: 'string', description: 'Юридический адрес' },
    actual_address:{ type: 'string', description: 'Фактический адрес' },
    account:       { type: 'string', description: 'Расчётный счёт (Р/С)' },
    bank:          { type: 'string', description: 'Название банка' },
    bik:           { type: 'string', description: 'БИК' },
    corr_account:  { type: 'string', description: 'Корр. счёт (К/С)' },
    // общее
    address:       { type: 'string', description: 'Адрес (регистрации — для физлица)' },
    phone:         { type: 'string', description: 'Телефон' },
    email:         { type: 'string', description: 'Email' },
  },
} as const

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { text, pdf } = await req.json() as { text?: string; pdf?: string }
  if (!text?.trim() && !pdf) return NextResponse.json({ error: 'no input' }, { status: 400 })

  const sys = 'Ты извлекаешь реквизиты Заказчика из карточки предприятия или произвольного текста для договора. ' +
    'Определи тип: физлицо (паспорт) или юрлицо/ИП (ИНН, ОГРН). Заполняй только реально присутствующие поля, ничего не выдумывай. ' +
    'Директора для «в лице» приводи в родительном падеже (напр. «Иванова Ивана Ивановича»).'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = []
  if (pdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } })
  content.push({ type: 'text', text: (text?.trim() ? `Текст с реквизитами:\n${text}\n\n` : '') + 'Извлеки реквизиты Заказчика в структуру.' })

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 1500,
      system: sys,
      tools: [{ name: 'customer', description: 'Реквизиты заказчика', input_schema: CUSTOMER_SCHEMA }],
      tool_choice: { type: 'tool', name: 'customer' },
      messages: [{ role: 'user', content }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    return NextResponse.json({ customer: tool.input })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'parse_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
