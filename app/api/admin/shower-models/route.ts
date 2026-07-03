import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as adminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { isOwnerRole } from '@/lib/getRole'

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SRK  = process.env.SUPABASE_SERVICE_ROLE_KEY!

function admin() { return adminClient(URL, SRK) }

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(URL, ANON, { cookies: { getAll: () => cookieStore.getAll() } })
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET → все модели душевых (открыто, как shower-images GET)
export async function GET() {
  const { data } = await admin().from('shower_models').select('*').order('sort_order')
  return NextResponse.json(data ?? [])
}

// POST → обновить редактируемые поля модели по code (owner only)
export async function POST(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = admin()
  const { data: u } = await db.from('users').select('role').eq('id', user.id).single()
  if (!isOwnerRole(u?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json() as {
    code?: string; title?: string; description?: string
    hardware_base?: number; active?: boolean; sort_order?: number
  }
  if (!body.code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.title       !== undefined) patch.title = body.title
  if (body.description !== undefined) patch.description = body.description
  if (body.hardware_base !== undefined) patch.hardware_base = body.hardware_base
  if (body.active      !== undefined) patch.active = body.active
  if (body.sort_order  !== undefined) patch.sort_order = body.sort_order

  const { error } = await db.from('shower_models').update(patch).eq('code', body.code)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
