import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isKnowledgeCategory } from '@/lib/knowledge/aiKnowledge'

// База знаний AI. Только владелец: записи уходят прямо в промпт бота, который
// пишет клиентам без подтверждения человеком.

async function editorEmail(): Promise<string | null> {
  const { data: { user } } = await (await createClient()).auth.getUser()
  return user?.email ?? null
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const service = createServiceClient()
  const [items, gaps] = await Promise.all([
    service.from('ai_knowledge').select('*').eq('active', true).order('category').order('sort_order').order('id'),
    service.from('ai_knowledge_gaps').select('*').eq('status', 'open').order('created_at', { ascending: false }).limit(200),
  ])
  if (items.error) return NextResponse.json({ error: items.error.message }, { status: 500 })
  if (gaps.error) return NextResponse.json({ error: gaps.error.message }, { status: 500 })
  return NextResponse.json({ items: items.data, gaps: gaps.data })
}

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const title = cleanText(body.title, 200)
  const content = cleanText(body.content, 4000)
  if (!isKnowledgeCategory(body.category) || !title || !content) {
    return NextResponse.json({ error: 'Нужны раздел, заголовок и текст' }, { status: 400 })
  }
  const service = createServiceClient()
  const by = await editorEmail()
  const { data, error } = await service.from('ai_knowledge').insert({
    category: body.category, title, content,
    for_bot: body.for_bot !== false,
    sort_order: Number.isFinite(body.sort_order) ? Number(body.sort_order) : 100,
    updated_by: by,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Факт добавлен в ответ на вопрос, который бот не смог закрыть, — пробел закрыт.
  const gapId = Number(body.gap_id)
  if (Number.isInteger(gapId) && gapId > 0) {
    await service.from('ai_knowledge_gaps').update({
      status: 'answered', knowledge_id: data.id, resolved_at: new Date().toISOString(), resolved_by: by,
    }).eq('id', gapId)
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const id = Number(body.id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Нет id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('category' in body) {
    if (!isKnowledgeCategory(body.category)) return NextResponse.json({ error: 'Неизвестный раздел' }, { status: 400 })
    patch.category = body.category
  }
  if ('title' in body) {
    const t = cleanText(body.title, 200)
    if (!t) return NextResponse.json({ error: 'Заголовок пустой' }, { status: 400 })
    patch.title = t
  }
  if ('content' in body) {
    const c = cleanText(body.content, 4000)
    if (!c) return NextResponse.json({ error: 'Текст пустой' }, { status: 400 })
    patch.content = c
  }
  if (typeof body.for_bot === 'boolean') patch.for_bot = body.for_bot
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Нечего сохранять' }, { status: 400 })

  patch.updated_at = new Date().toISOString()
  patch.updated_by = await editorEmail()
  const { data, error } = await createServiceClient().from('ai_knowledge').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Удаление мягкое: запись могла закрывать пробел, связь сохраняется.
export async function DELETE(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { id } = await req.json().catch(() => ({})) as { id?: number }
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Нет id' }, { status: 400 })
  const { error } = await createServiceClient().from('ai_knowledge')
    .update({ active: false, updated_at: new Date().toISOString(), updated_by: await editorEmail() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
