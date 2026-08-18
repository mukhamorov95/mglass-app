import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireOwner } from '@/lib/apiAuth'
import { createSetupToken } from '@/lib/setupToken'
import { randomBytes } from 'crypto'

// Онбординг партнёра из приложения (только владелец). Создаёт auth-аккаунт,
// роль partner, профиль в отдельной организации (id 2) и привязку к b2b_client —
// без захода в Supabase. Партнёр потом сам меняет пароль в кабинете.

const PARTNER_ORG = 2

function genPassword(): string {
  return randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 10) + 'A1'
}

function svc() {
  return createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Список клиентов + статус кабинета (привязан ли партнёрский аккаунт).
export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const db = svc()
  const { data: clients } = await db.from('b2b_clients')
    .select('id,name,contact,phone,discount_percent,user_id,active')
    .eq('active', true).order('name')

  const withEmail = await Promise.all((clients ?? []).map(async (c: Record<string, unknown>) => {
    let email: string | null = null
    if (c.user_id) {
      const { data } = await db.auth.admin.getUserById(c.user_id as string)
      email = data?.user?.email ?? null
    }
    return {
      id: c.id, name: c.name, contact: c.contact ?? null, phone: c.phone ?? null,
      discountPercent: Number(c.discount_percent) || 0,
      linked: !!c.user_id, email,
    }
  }))

  return NextResponse.json({ clients: withEmail })
}

// Создать доступ партнёру к его клиенту.
export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const body = await req.json().catch(() => ({}))
  const clientId = Number(body?.clientId)
  const email = String(body?.email || '').trim().toLowerCase()
  const wantPass = String(body?.password || '').trim()
  if (!clientId || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Укажите клиента и корректный email' }, { status: 400 })
  }
  if (wantPass && wantPass.length < 8) {
    return NextResponse.json({ error: 'Пароль минимум 8 символов' }, { status: 400 })
  }

  const db = svc()
  const { data: client } = await db.from('b2b_clients').select('id,name,user_id').eq('id', clientId).maybeSingle()
  if (!client) return NextResponse.json({ error: 'Клиент не найден' }, { status: 404 })
  if (client.user_id) return NextResponse.json({ error: 'У этого клиента уже есть доступ' }, { status: 400 })

  const password = wantPass || genPassword()

  const { data: created, error: cErr } = await db.auth.admin.createUser({ email, password, email_confirm: true })
  if (cErr || !created?.user) return NextResponse.json({ error: cErr?.message || 'Не удалось создать аккаунт' }, { status: 400 })
  const uid = created.user.id

  const { error: uErr } = await db.from('users').upsert({ id: uid, name: client.name, email, role: 'partner' }, { onConflict: 'id' })
  if (uErr) return NextResponse.json({ error: 'users: ' + uErr.message }, { status: 500 })
  await db.from('profiles').upsert({ user_id: uid, organization_id: PARTNER_ORG, role: 'partner' }, { onConflict: 'user_id' })
  const { error: linkErr } = await db.from('b2b_clients').update({ user_id: uid }).eq('id', clientId)
  if (linkErr) return NextResponse.json({ error: 'link: ' + linkErr.message }, { status: 500 })

  // Ссылка самостоятельной установки пароля (свой токен, без SMTP/плейнтекста):
  // партнёр переходит и задаёт пароль сам. Владелец отправляет ссылку по email.
  const token = await createSetupToken(uid)
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin).replace(/\/$/, '')
  return NextResponse.json({ ok: true, email, clientName: client.name, link: `${base}/set-password?token=${token}` })
}
