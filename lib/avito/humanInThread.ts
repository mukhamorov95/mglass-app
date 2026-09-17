// Писал ли в чат Авито живой человек — сверка по самой переписке в Авито.
//
// Жёсткое правило владельца: менеджер написал в чат — бот больше не пишет туда
// НИЧЕГО. Эхо-детектор вебхука (16.09.2026) ловит только новые сообщения. Всё, что
// менеджеры писали прямо из Авито/амо раньше, в нашу ленту не попало: лид 405 —
// менеджер ответил «не обращайте внимания на бота», а бот написал следом. Поэтому
// перед каждой отправкой сверяем исходящие в Авито с тем, что отправлял сам бот.

import type { SupabaseClient } from '@supabase/supabase-js'
import { avitoListMessages, type AvitoMsg } from '@/lib/avito'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

// Лента хранит реплики с обрезкой, Авито — целиком: сравниваем и по началу текста.
function sameText(a: string, b: string): boolean {
  if (a === b) return true
  const head = 200
  return a.length >= head && b.length >= head && a.slice(0, head) === b.slice(0, head)
}

// Первое исходящее сообщение в чате, которое не отправлял бот. null — людей не было.
export function findHumanOutgoing(msgs: AvitoMsg[], selfId: number, botTexts: string[]): string | null {
  const bot = botTexts.map(norm).filter(Boolean)
  for (const m of msgs) {
    const out = m.direction === 'out' || m.author_id === selfId
    const text = norm(m.content?.text ?? '')
    if (!out || !text) continue
    if (!bot.some(b => sameText(b, text))) return m.content?.text ?? text
  }
  return null
}

// true — человек в чате есть (лид заглушён сейчас или уже был). Ошибка чтения
// Авито не блокирует бота: новые ответы менеджеров всё равно ловит эхо вебхука.
export async function muteIfHumanInThread(
  service: SupabaseClient,
  lead: { id: number; bot_muted?: boolean | null },
  userId: number,
  chatId: string,
): Promise<boolean> {
  if (lead.bot_muted) return true
  let msgs: AvitoMsg[]
  try {
    msgs = await avitoListMessages(userId, chatId, { limit: 100 })
  } catch {
    return false
  }
  const { data } = await service.from('crm_lead_events')
    .select('text').eq('lead_id', lead.id).eq('kind', 'message').like('text', 'БОТ: %')
    .order('id', { ascending: false }).limit(500)
  const botTexts = ((data ?? []) as { text: string }[]).map(e => e.text.slice(5))
  const human = findHumanOutgoing(msgs, userId, botTexts)
  if (!human) return false

  const now = new Date().toISOString()
  await service.from('crm_leads').update({
    bot_muted: true, bot_muted_at: now, bot_muted_by: 'менеджер писал в чате Авито', updated_at: now,
  }).eq('id', lead.id)
  // Реплику менеджера в ленту как сообщение не пишем: она старая, а в ленте встала бы
  // с сегодняшней датой и перепутала хронологию. Полная переписка — в чате Авито.
  await service.from('crm_lead_events').insert({
    lead_id: lead.id, kind: 'system', author: 'AI',
    text: `🔇 Иван выключен в этом чате: в переписке Авито уже писал менеджер («${human.replace(/\s+/g, ' ').slice(0, 120)}»)`,
  })
  return true
}
