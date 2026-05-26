import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { getRole } from '@/lib/getRole'

export async function POST(req: NextRequest) {
  const role = await getRole()
  if (!role || (role !== 'admin' && role !== 'ceo')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { fixId } = await req.json()
  const sb = await createClient()

  // ── sync_b2b_materials: populate b2b_materials from glass_price_matrix ────────
  if (fixId === 'sync_b2b_materials') {
    const { data: glass, error: gErr } = await sb
      .from('glass_price_matrix')
      .select('name, category')
      .eq('price_type', 'cost')

    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })

    if (!glass?.length) {
      return NextResponse.json({
        success: false,
        message: 'Нет данных в glass_price_matrix для синхронизации',
      })
    }

    const { data: existing } = await sb.from('b2b_materials').select('name')
    const existingNames = new Set((existing ?? []).map((r: { name: string }) => r.name))
    const toAdd = glass.filter(g => !existingNames.has(g.name))

    if (!toAdd.length) {
      return NextResponse.json({ success: true, count: 0, message: 'Все позиции уже присутствуют в b2b_materials' })
    }

    const { error } = await sb
      .from('b2b_materials')
      .insert(toAdd.map(g => ({ name: g.name, active: true })))

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      count: toAdd.length,
      message: `Добавлено ${toAdd.length} позиций в b2b_materials`,
    })
  }

  // ── sync_b2b_from_glass: deactivate orphaned b2b_materials ────────────────────
  // Deactivates b2b_materials whose names no longer exist in glass_price_matrix.
  // These are stale/renamed entries that cause the sync warning.
  if (fixId === 'sync_b2b_from_glass') {
    const { data: glass, error: gErr } = await sb
      .from('glass_price_matrix')
      .select('name')
      .eq('price_type', 'cost')

    if (gErr) return NextResponse.json({ error: gErr.message }, { status: 500 })

    const { data: b2b, error: bErr } = await sb
      .from('b2b_materials')
      .select('id, name')
      .eq('active', true)

    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

    const glassSet = new Set((glass ?? []).map((r: { name: string }) => r.name))
    const orphaned = (b2b ?? []).filter((r: { id: number; name: string }) => !glassSet.has(r.name))

    if (!orphaned.length) {
      return NextResponse.json({ success: true, count: 0, message: 'Все b2b_materials есть в glass_price_matrix — несоответствий нет' })
    }

    const orphanIds = orphaned.map((r: { id: number }) => r.id)
    const { error: uErr } = await sb
      .from('b2b_materials')
      .update({ active: false })
      .in('id', orphanIds)

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

    const names = orphaned.map((r: { name: string }) => r.name).join(', ')
    return NextResponse.json({
      success: true,
      count: orphaned.length,
      message: `Деактивировано ${orphaned.length} устаревших позиций: ${names}`,
    })
  }

  // ── Assign role=manager to users with null role ──────────────────────────────
  if (fixId === 'fix_roles_null') {
    const { data: nullUsers, error: fErr } = await sb
      .from('users')
      .select('id, email')
      .is('role', null)

    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 })

    if (!nullUsers?.length) {
      return NextResponse.json({ success: true, count: 0, message: 'Нет пользователей без роли' })
    }

    const { error: uErr } = await sb
      .from('users')
      .update({ role: 'manager' })
      .is('role', null)

    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

    return NextResponse.json({
      success: true,
      count: nullUsers.length,
      message: `Назначена роль manager для ${nullUsers.length} пользователей (уточните при необходимости в /admin/users)`,
    })
  }

  return NextResponse.json({ error: `Unknown fixId: ${fixId}` }, { status: 400 })
}
