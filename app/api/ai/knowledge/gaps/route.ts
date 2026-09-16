import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// «Не нужно»: вопрос не про нас или разовый — убираем из списка пробелов.
export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const { id } = await req.json().catch(() => ({})) as { id?: number }
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Нет id' }, { status: 400 })
  const { data: { user } } = await (await createClient()).auth.getUser()
  const { error } = await createServiceClient().from('ai_knowledge_gaps').update({
    status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: user?.email ?? null,
  }).eq('id', id).eq('status', 'open')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
