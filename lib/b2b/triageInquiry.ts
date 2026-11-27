import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { createServiceClient } from '@/lib/supabase-service'
import { readInquirySegment } from '@/lib/ai-tools/inquirySegment'
import { buildTriage, triageLine, STARTER_THRESHOLDS, type TierThresholds, type Triage } from '@/lib/b2b/inquiryTriage'

// Разметка заявки и запись её в строку (этап В3). Зовётся из вебхука GLASMEN, который
// закрыт своим секретом; пишет service-role'ом ровно одну свою заявку по её id —
// роль здесь не проверяется потому, что это не запрос пользователя, а продолжение приёма
// вебхука, и других строк этот вызов не трогает.
//
// Best effort: упавшая модель или отсутствующий ключ не должны терять заявку. Тогда
// строка остаётся без разметки, а причина уходит в лог — «не разобрано» видно по пустому
// triaged_at, и это честнее, чем «частник» по умолчанию.

export async function loadThresholds(): Promise<TierThresholds> {
  const svc = createServiceClient()
  const { data, error } = await svc.from('b2b_inquiry_triage_settings')
    .select('batch_from, large_from').eq('id', true).maybeSingle()
  if (error) { console.error('[triage] пороги не прочитаны', error.message); return STARTER_THRESHOLDS }
  if (!data) return STARTER_THRESHOLDS
  return { batchFrom: Number(data.batch_from), largeFrom: Number(data.large_from) }
}

/** Разметить текст заявки и сохранить в строку. Возвращает строку-подпись или null. */
export async function triageInquiry(inquiryId: number, text: string): Promise<{ triage: Triage; line: string } | null> {
  if (!text?.trim()) return null

  const thresholds = await loadThresholds()

  let opinion: { segment?: unknown; repeat?: unknown } | null = null
  const key = process.env.ANTHROPIC_API_KEY
  if (key) {
    const r = await readInquirySegment(new Anthropic({ apiKey: key }), text)
    if (r.ok) opinion = r.opinion
    else console.error('[triage] сегмент не прочитан', inquiryId, r.error)
  }

  const triage = buildTriage(text, opinion, thresholds)
  const svc = createServiceClient()
  const { error } = await svc.from('b2b_inquiries').update({
    triage_segment: triage.segment,
    triage_tier: triage.tier,
    triage_units: triage.units,
    triage_repeat: triage.repeat,
    triage_gaps: triage.gaps,
    triaged_at: new Date().toISOString(),
  }).eq('id', inquiryId).select('id')
  if (error) console.error('[triage] разметка не сохранена', inquiryId, error.message)

  return { triage, line: triageLine(triage) }
}
