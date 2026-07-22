import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { isOwnerRole } from '@/lib/getRole'
import { computeBreakeven, type BreakevenModel } from '@/lib/breakeven'

// Точки безубыточности по юнитам финмодели — для подстановки месячного плана
// финнедели. Юниты ТБ (mglass/production/total) ≠ юниты бухгалтерии (ип/ооо),
// поэтому владелец сам выбирает, что взять; API лишь считает цифры.

export async function GET() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: profile } = await sb.from('users').select('role').eq('id', user.id).maybeSingle()
  if (!isOwnerRole(profile?.role) && profile?.role !== 'cfo') {
    return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 })
  }

  const { data } = await sb.from('finplan_models').select('unit, data')
  const LABELS: Record<string, string> = { mglass: 'M-Glass', production: 'Производство', total: 'Компания', total1: 'Компания (без кредитов)' }
  const targets = (data ?? [])
    .filter(r => (r.data as { incomes?: unknown[] } | null)?.incomes?.length)
    .map(r => ({
      unit: r.unit as string,
      label: LABELS[r.unit as string] ?? (r.unit as string),
      ...computeBreakeven(r.data as BreakevenModel),
    }))

  return NextResponse.json({ targets })
}
