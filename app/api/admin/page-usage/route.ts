import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Какие экраны открывают (маршрут docs/MANAGER_UX_ROUTE.md, У0). Только владелец.
// Переход = загрузка страницы или переход внутри приложения; предзагрузка ссылок не считается.

type PageRow = { user_id: string; route: string; device: string; hits: number }
type U = { id: string; name: string | null; email: string | null; role: string | null }

export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const sp = req.nextUrl.searchParams
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const now = new Date()
  const to = sp.get('to') || iso(now)
  const from = sp.get('from') || iso(new Date(now.getTime() - 6 * 86400000))

  const svc = createServiceClient()
  const { data, error } = await svc.from('user_page_days')
    .select('user_id,route,device,hits').gte('day', from).lte('day', to)
  if (error) return NextResponse.json({ error: `Не удалось прочитать user_page_days: ${error.message}` }, { status: 500 })
  const list = (data ?? []) as PageRow[]

  const uids = [...new Set(list.map(r => r.user_id))]
  const { data: us, error: uErr } = uids.length
    ? await svc.from('users').select('id,name,email,role').in('id', uids)
    : { data: [], error: null }
  if (uErr) return NextResponse.json({ error: `Не удалось прочитать пользователей: ${uErr.message}` }, { status: 500 })
  const umap = new Map<string, U>(((us ?? []) as U[]).map(u => [u.id, u]))

  const people = uids.map(id => {
    const u = umap.get(id)
    const mine = list.filter(r => r.user_id === id)
    const byRoute = new Map<string, number>()
    let total = 0, phone = 0
    for (const r of mine) {
      byRoute.set(r.route, (byRoute.get(r.route) ?? 0) + r.hits)
      total += r.hits
      if (r.device !== 'desktop') phone += r.hits
    }
    return {
      id,
      name: (u?.name?.trim()) || u?.email || id.slice(0, 8),
      role: u?.role ?? '—',
      total,
      phoneShare: total ? Math.round((phone / total) * 100) : 0,
      routes: [...byRoute.entries()].sort((a, b) => b[1] - a[1]).map(([route, hits]) => ({ route, hits })),
    }
  }).sort((a, b) => b.total - a.total)

  return NextResponse.json({ from, to, rows: list, people })
}
