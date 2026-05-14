import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as tg from '@/lib/telegram'

export const runtime = 'nodejs'
export const maxDuration = 60

function db() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function POST(req: Request) {
  // Проверяем сессию
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Файл не прикреплён' }, { status: 400 })
  if (file.type !== 'application/pdf') return NextResponse.json({ error: 'Только PDF' }, { status: 400 })
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const base64      = Buffer.from(arrayBuffer).toString('base64')

  // Читаем текущий каталог чтобы не дублировать
  const [{ data: materials }, { data: services }] = await Promise.all([
    db().from('materials').select('name').limit(100),
    db().from('services').select('name').limit(50),
  ])
  const existingNames = [
    ...(materials ?? []).map(m => m.name),
    ...(services  ?? []).map(s => s.name),
  ].join(', ')

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

  let extracted: Array<{
    table: 'materials' | 'services'
    name: string
    category?: string
    cost_price?: number
    unit?: string
    reason: string
  }> = []

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          } as any,
          {
            type: 'text',
            text: `Это прайс-лист или счёт поставщика для компании MGlass (стекло, зеркала, душевые, перегородки).

УЖЕ ЕСТЬ В КАТАЛОГЕ (не дублировать): ${existingNames.slice(0, 500)}

ЗАДАЧА: Извлеки все позиции из документа которых нет в каталоге.

Для каждой позиции определи:
- table: "materials" (физические материалы/товары) или "services" (работы/услуги)
- name: название на русском
- category: для materials выбери из (Стекло, Фурнитура, Комплектующие, Химия, Упаковка, Прочее)
- cost_price: цена из документа (число, без валюты)
- unit: единица измерения (шт, м², м.п., кг, л и т.д.)
- reason: почему это нужно MGlass (1 фраза)

Верни строго JSON-массив без пояснений:
[{"table":"materials","name":"...","category":"...","cost_price":0,"unit":"шт","reason":"..."}]

Если позиций много — возьми только самые релевантные для MGlass (до 20 штук).`,
          },
        ],
      }],
    })

    const text     = resp.content.find(b => b.type === 'text')?.text ?? '[]'
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      extracted = parsed.filter((p: any) => ['materials', 'services'].includes(p.table) && p.name)
    }
  } catch (err) {
    return NextResponse.json({ error: `Ошибка парсинга PDF: ${err}` }, { status: 500 })
  }

  if (!extracted.length) {
    return NextResponse.json({ ok: true, found: 0, message: 'Новых позиций не найдено' })
  }

  // Добавляем в очередь одобрения
  const supabaseDb = db()
  const { data: settings } = await supabaseDb
    .from('agent_settings').select('memory').eq('agent_key', 'catalog').single()
  const memory = (settings?.memory ?? {}) as Record<string, unknown>

  const newPending = extracted.map(item => ({
    id:         `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    table:      item.table,
    name:       item.name,
    category:   item.category ?? null,
    cost_price: item.cost_price ?? null,
    unit:       item.unit ?? null,
    reason:     item.reason,
    source:     `PDF: ${file.name}`,
    created_at: new Date().toISOString(),
  }))

  const allPending = [...((memory.pending_approvals as any[]) ?? []), ...newPending].slice(-50)

  await supabaseDb.from('agent_settings').update({
    memory: { ...memory, pending_approvals: allPending },
    updated_at: new Date().toISOString(),
  }).eq('agent_key', 'catalog')

  // Лог
  await supabaseDb.from('agent_logs').insert({
    agent_key: 'catalog',
    level:     'info',
    icon:      'ℹ️',
    message:   `Загружен PDF "${file.name}" — найдено ${extracted.length} позиций`,
    meta:      { source: file.name, count: extracted.length },
    ran_at:    new Date().toISOString(),
  })

  // Telegram — уведомление с кнопками
  const header = [
    `📄 <b>Наполнитель — PDF загружен</b>`,
    `<i>${file.name}</i>`,
    ``,
    `Найдено <b>${extracted.length}</b> новых позиций. Одобряй:`,
  ].join('\n')
  await tg.notifyAdmins(header).catch(() => {})

  for (const item of newPending) {
    const priceStr = item.cost_price ? ` · ${item.cost_price.toLocaleString('ru-RU')} ₽` : ''
    const unitStr  = item.unit ? `/${item.unit}` : ''
    const text = [
      `📋 [${item.table}] <b>${item.name}</b>${item.category ? ` (${item.category})` : ''}${priceStr}${unitStr}`,
      `<i>${item.reason}</i>`,
    ].join('\n')
    const kb = [[
      { text: '✅ Добавить', callback_data: `catalog:approve:${item.id}` },
      { text: '❌ Пропустить', callback_data: `catalog:reject:${item.id}` },
    ]]
    await tg.notifyAdminsWithKeyboard(text, kb).catch(() => {})
  }

  return NextResponse.json({ ok: true, found: extracted.length, items: extracted.map(i => i.name) })
}
