import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/apiAuth'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function genPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  return 'Mg' + Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

const MANAGERS_TO_SEED = [
  { name: 'Александра', email: 'manager02@mglass.ru', manager_code: 2 },
  { name: 'Яна',        email: 'manager04@mglass.ru', manager_code: 4 },
]

export async function POST() {
  // Strictly admin: bulk-creates auth users with fresh passwords (bootstrap utility).
  const guard = await requireAdmin()
  if (guard instanceof NextResponse) return guard

  const db = adminClient()
  const results: { name: string; email: string; password: string; status: string }[] = []

  for (const m of MANAGERS_TO_SEED) {
    const existingAuth = await db.auth.admin.listUsers()
    const alreadyExists = existingAuth.data?.users.some(u => u.email === m.email)

    if (alreadyExists) {
      results.push({ name: m.name, email: m.email, password: '(уже существует)', status: 'skipped' })
      continue
    }

    const password = genPassword()

    const { data, error } = await db.auth.admin.createUser({
      email: m.email,
      password,
      email_confirm: true,
    })

    if (error || !data.user) {
      results.push({ name: m.name, email: m.email, password: '', status: `error: ${error?.message}` })
      continue
    }

    await db.from('users').update({
      name: m.name,
      role: 'manager',
      manager_code: m.manager_code,
      password_plain: password,
      active: true,
    }).eq('id', data.user.id)

    results.push({ name: m.name, email: m.email, password, status: 'created' })
  }

  return NextResponse.json({ results })
}

// Safety: only POST allowed — no accidental GET triggering
export async function GET() {
  return NextResponse.json({ error: 'Use POST' }, { status: 405 })
}
