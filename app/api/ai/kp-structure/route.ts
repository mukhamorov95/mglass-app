import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { reconcileKp } from '@/lib/kpReconcile'
import { KP_SCHEMA } from '@/lib/kp/schema'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

// Разбор надиктованного текста в структуру КП. Поддерживает дозапись: если
// передан existing — обновляем его новой репликой, не затирая уже заполненное.

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { transcript, existing } = await req.json() as {
    transcript?: string
    existing?: Record<string, unknown> | null
  }
  if (!transcript || !transcript.trim()) {
    return NextResponse.json({ error: 'empty transcript' }, { status: 400 })
  }

  const sys = [
    'Ты помощник менеджера стекольной компании M-Glass. Разбираешь надиктованную речь',
    'в структуру коммерческого предложения (КП). Извлекай ТОЛЬКО то, что реально сказано.',
    'СТРОГО ЗАПРЕЩЕНО добавлять от себя: названия линеек/коллекций/брендов/моделей',
    '(напр. «AURA», «RADUGA CLASS»), маркетинговые эпитеты, эмодзи, а также цены/суммы,',
    'которых менеджер не называл. Формулировки бери близко к сказанному, не приукрашивай.',
    'Числа приводи к числовому виду (без пробелов и «₽»).',
    'КАЖДАЯ строка (включая доставку и монтаж) ОБЯЗАНА иметь свою sum. Если менеджер',
    'назвал общий итог, а услугу (доставка/подъём/монтаж) без отдельной цены — раздели:',
    'sum этой строки = итого − сумма остальных строк. total = сумме всех строк (если не названа скидка).',
    'ВАЖНО про описание изделия (поле desc у items): собирай его строго в порядке —',
    'материал (стекло/зеркало), тип материала (осветлённое/не осветлённое, марка напр. М1),',
    'обработка и толщина (закалённое 8 мм), доп. информация, фурнитура и её цвет, цвет рамы',
    '(если металлическая), цвет (если лофт), в конце размеры. Пример desc:',
    '«стекло прозрачное не осветлённое М1, закалённое 8 мм, фурнитура чёрная матовая. Размеры 855х1245х1950 мм».',
    'Если передан existing — это уже заполненный КП, обнови его новой репликой: добавляй/исправляй названное, остальное как есть.',
  ].join(' ')

  const userMsg = existing
    ? `Текущий КП (JSON):\n${JSON.stringify(existing)}\n\nНовая реплика менеджера:\n"${transcript}"\n\nВерни обновлённый КП.`
    : `Реплика менеджера:\n"${transcript}"\n\nРазбери в структуру КП.`

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-8',
      max_tokens: 2000,
      system: sys,
      tools: [{ name: 'kp', description: 'Структура коммерческого предложения', input_schema: KP_SCHEMA }],
      tool_choice: { type: 'tool', name: 'kp' },
      messages: [{ role: 'user', content: userMsg }],
    })
    const tool = msg.content.find(c => c.type === 'tool_use')
    if (!tool || tool.type !== 'tool_use') {
      return NextResponse.json({ error: 'no_structure' }, { status: 502 })
    }
    return NextResponse.json({ kp: reconcileKp(tool.input as Record<string, unknown>) })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'structure_failed', detail: detail.slice(0, 200) }, { status: 502 })
  }
}
