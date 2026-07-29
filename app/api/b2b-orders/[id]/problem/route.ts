import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/getRole'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { ANDON_REASONS } from '@/lib/productionRouting'

// Проблема с экрана по QR (/p/o/[orderId]).
//
// Раньше кнопка «Зафиксировать проблему» писала только в notes.detail_stages,
// а этот блоб намеренно исключён из синка в production_tasks (sync-stages) —
// проблема физически не доходила до экранов, где её ищут, и никто её не видел.
// Теперь пишем в production_tasks: помечаем ФРОНТИР позиции (первый незакрытый
// этап) — он же и есть место, где мастер упёрся.

const CODES = new Set(ANDON_REASONS.map(r => r.code))

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const orderId = Number((await ctx.params).id)
  if (!orderId) return NextResponse.json({ error: 'Некорректный заказ' }, { status: 400 })

  let b: Record<string, unknown>
  try { b = await req.json() } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }) }

  const items = Array.isArray(b.item_indexes) ? (b.item_indexes as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0) : []
  if (!items.length) return NextResponse.json({ error: 'Не выбрана ни одна позиция' }, { status: 400 })

  const reason = String(b.reason_code ?? '')
  if (!CODES.has(reason)) return NextResponse.json({ error: 'Неизвестная причина' }, { status: 400 })
  const comment = (b.comment as string)?.trim() || null

  const sb = createServiceClient()
  const supa = await createClient()
  const { data: prof } = await supa.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? null

  const { data: rows, error } = await sb.from('production_tasks')
    .select('id, item_index, sequence_order, status')
    .eq('order_id', orderId).in('item_index', items)
    .neq('status', 'done')
    .order('sequence_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Фронтир каждой позиции — первый незакрытый этап
  const frontier = new Map<number, number>()
  for (const r of (rows ?? []) as { id: number; item_index: number }[]) {
    if (!frontier.has(r.item_index)) frontier.set(r.item_index, r.id)
  }
  if (frontier.size === 0) {
    return NextResponse.json({ error: 'По этим позициям нет открытых этапов' }, { status: 409 })
  }

  const now = new Date().toISOString()
  const ids = [...frontier.values()]
  const { error: updErr } = await sb.from('production_tasks').update({
    status: 'problem',
    problem_reason_code: reason,
    problem_comment: comment,
    problem_at: now,
    problem_resolved_at: null,
    problem_by_name: who,
    updated_at: now,
  }).in('id', ids)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, marked: ids.length, skipped: items.length - frontier.size })
}
