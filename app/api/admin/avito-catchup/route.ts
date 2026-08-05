import { NextRequest, NextResponse } from 'next/server'
import { createClient as svc } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { avitoSendMessage, avitoGetSelfId, isAvitoConfigured } from '@/lib/avito'
import { CRM_ZONES } from '@/lib/crmStages'

// Одноразовый «догон» после сбоя AI (кончились кредиты 05.08): находит Авито-лиды,
// где было «Ошибка AI / AI недоступен» и клиент остался без ответа, и отправляет
// один вежливый догон. Идемпотентно (повторный запуск не дублирует).
//   GET  — сухой прогон: список зависших лидов, ничего не отправляет.
//   POST { confirm: true } — отправка. Только владелец (admin/ceo).

const AI_MANAGERS = ['Иван (AI)', 'AI-менеджер']
const QUALIFICATION_STAGES = new Set(CRM_ZONES.find(z => z.zone === 'Квалификация')?.stages ?? [])

const CATCHUP_TEXT = 'Здравствуйте! Извините за задержку с ответом — мы на связи. Подскажите, что вас интересует (изделие и примерные размеры), и я всё посчитаю. Если удобнее — оставьте номер телефона, и менеджер оперативно свяжется с вами.'
const CATCHUP_MARK = '📣 Догон после сбоя AI'
// Фразы, по которым видно, что клиенту уже что-то ответили после сбоя.
const ANSWERED_RE = /Извините за задержку|подключаю менеджера|уже на связи|Догон после сбоя/i

function db() {
  return svc(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

type Stuck = { id: number; name: string | null; phone: string | null; chatId: string; userId: number | null; lastClient: string; when: string }

// Собирает список зависших после сбоя лидов (общий код для GET и POST).
async function collectStuck(service: ReturnType<typeof db>, days: number, cap: number): Promise<Stuck[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const { data: errEvents } = await service.from('crm_lead_events')
    .select('lead_id,text').eq('kind', 'system').gte('created_at', since)
    .order('id', { ascending: false }).limit(3000)
  const errLeadIds = [...new Set(((errEvents ?? []) as { lead_id: number; text: string }[])
    .filter(e => /Ошибка AI|AI недоступен/i.test(e.text)).map(e => e.lead_id))]

  const stuck: Stuck[] = []
  for (const id of errLeadIds) {
    if (stuck.length >= cap) break
    const { data: lead } = await service.from('crm_leads')
      .select('id, avito_chat_id, avito_user_id, manager, stage, status, name, phone').eq('id', id).maybeSingle()
    const l = lead as Record<string, unknown> | null
    if (!l || !l.avito_chat_id) continue
    if (l.status === 'lost') continue
    const mgr = (l.manager as string | null) ?? null
    if (mgr && !AI_MANAGERS.includes(mgr)) continue          // чат забрал человек
    const stage = (l.stage as string | null) ?? null
    if (stage && !QUALIFICATION_STAGES.has(stage)) continue   // ушёл дальше зоны робота

    const { data: evs } = await service.from('crm_lead_events')
      .select('kind,text,created_at').eq('lead_id', id).order('id', { ascending: false }).limit(14)
    const rows = (evs ?? []) as { kind: string; text: string; created_at: string }[]
    if (rows.some(e => ANSWERED_RE.test(e.text))) continue    // уже ответили / уже был догон
    const lastMsg = rows.find(e => e.kind === 'message')
    if (!lastMsg || !lastMsg.text.startsWith('КЛИЕНТ:')) continue  // последнее слово не за клиентом

    stuck.push({
      id: l.id as number,
      name: (l.name as string | null) ?? null,
      phone: (l.phone as string | null) ?? null,
      chatId: l.avito_chat_id as string,
      userId: (l.avito_user_id as number | null) ?? null,
      lastClient: lastMsg.text.replace(/^КЛИЕНТ: /, '').slice(0, 160),
      when: lastMsg.created_at,
    })
  }
  return stuck
}

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 3))
  const stuck = await collectStuck(db(), days, 100)
  return NextResponse.json({
    dryRun: true, days, count: stuck.length,
    hint: 'Отправить: POST этому же URL с телом {"confirm":true}',
    leads: stuck.map(s => ({ id: s.id, name: s.name, phone: s.phone, lastClient: s.lastClient, when: s.when, hasUserId: s.userId != null })),
  })
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  if (!isAvitoConfigured()) return NextResponse.json({ error: 'Avito не сконфигурирован' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { confirm?: boolean; days?: number }
  if (body.confirm !== true) return NextResponse.json({ error: 'Нужен {"confirm":true}. Сначала посмотрите список через GET.' }, { status: 400 })

  const service = db()
  const days = Math.min(30, Math.max(1, Number(body.days) || 3))
  const stuck = await collectStuck(service, days, 100)

  // id аккаунта нужен как {user_id} для мессенджера; берём с лида, иначе — self.
  let selfId: number | null = null
  const needsSelf = stuck.some(s => s.userId == null)
  if (needsSelf) { try { selfId = await avitoGetSelfId() } catch { selfId = null } }

  const results: { id: number; sent: boolean; error?: string }[] = []
  for (const s of stuck) {
    const userId = s.userId ?? selfId
    if (userId == null) { results.push({ id: s.id, sent: false, error: 'нет user_id аккаунта' }); continue }
    try {
      await avitoSendMessage(userId, s.chatId, CATCHUP_TEXT)
      await service.from('crm_lead_events').insert([
        { lead_id: s.id, kind: 'message', text: `БОТ: ${CATCHUP_TEXT}`, author: 'AI' },
        { lead_id: s.id, kind: 'system', text: `${CATCHUP_MARK} — отправлено клиенту, ждём ответа`, author: 'AI' },
      ])
      await service.from('crm_leads').update({ updated_at: new Date().toISOString() }).eq('id', s.id)
      results.push({ id: s.id, sent: true })
    } catch (e) {
      results.push({ id: s.id, sent: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return NextResponse.json({
    ok: true, considered: stuck.length,
    sent: results.filter(r => r.sent).length,
    failed: results.filter(r => !r.sent),
  })
}
