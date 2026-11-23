import { NextResponse, type NextRequest } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { previewWriteGuard } from '@/lib/partnerPreview'
import { createSetupToken } from '@/lib/setupToken'
import { appUrl } from '@/lib/appUrl'
import { isTeamRole, TEAM_ROLE_RU } from '@/lib/partner/teamRoles'
import { loadTeam, seatsUsed } from '@/lib/partner/team'
import { writeLogForCurrentUser } from '@/lib/activityLog'

// «Команда» руководителя партнёра (docs/PARTNER_TEAM_ROUTE.md, Т2): список, приглашение ссылкой,
// смена роли, отключение. Только право «команда» (руководитель). Пароль человек задаёт сам по
// ссылке; ссылку руководитель пересылает сам — писем мы не шлём.

const PARTNER_ORG = 2  // organizations «Партнёры B2B»: профиль партнёра никогда не в org 1

type Svc = ReturnType<typeof createServiceClient>

async function ctx() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Не авторизован' }, { status: 401 }) }
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number; name: string; max_members: number | null }>(svc, user.id, 'id,name,max_members')
  if (!pm) return { error: NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 }) }
  const denied = denyUnless(pm.role, 'team')
  if (denied) return { error: denied }
  return { user, svc, pm }
}

const randomPw = () => Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')
const cleanName = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

async function memberOf(svc: Svc, clientId: number, userId: string) {
  const { data } = await svc.from('b2b_client_members').select('user_id, role, disabled_at').eq('client_id', clientId).eq('user_id', userId).maybeSingle()
  return data as { user_id: string; role: string; disabled_at: string | null } | null
}

export async function GET() {
  const c = await ctx()
  if ('error' in c) return c.error
  try {
    const team = await loadTeam(c.svc, c.pm.client.id)
    return NextResponse.json({ team, seats: { used: seatsUsed(team), max: c.pm.client.max_members ?? 10 }, me: c.user.id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Пригласить: { name, email, role } → ссылка на пароль.
export async function POST(req: NextRequest) {
  const c = await ctx()
  if ('error' in c) return c.error
  const blocked = await previewWriteGuard(c.svc, c.user.id)
  if (blocked) return blocked
  const { svc, pm, user } = c
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // Новая ссылка тому, кто не успел задать пароль или забыл его.
  if (body.action === 'relink') {
    const target = String(body.userId ?? '')
    const m = await memberOf(svc, pm.client.id, target)
    if (!m) return NextResponse.json({ error: 'Сотрудник не найден' }, { status: 404 })
    if (m.disabled_at) return NextResponse.json({ error: 'Сотрудник отключён — сначала включите' }, { status: 400 })
    const token = await createSetupToken(target)
    return NextResponse.json({ ok: true, link: `${appUrl()}/set-password?token=${token}` })
  }

  const name = cleanName(body.name)
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = body.role
  if (!name) return NextResponse.json({ error: 'Укажите имя сотрудника' }, { status: 400 })
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 120) return NextResponse.json({ error: 'Укажите корректный email — он станет логином' }, { status: 400 })
  if (!isTeamRole(role)) return NextResponse.json({ error: 'Выберите роль' }, { status: 400 })

  let team
  try { team = await loadTeam(svc, pm.client.id) }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }) }
  const max = pm.client.max_members ?? 10
  if (seatsUsed(team) >= max) return NextResponse.json({ error: `Все ${max} мест заняты. Отключите неактивного сотрудника или напишите нам` }, { status: 409 })

  // Только новый email: существующую учётку (наш сотрудник, другая компания) приглашение
  // не забирает — иначе руководитель партнёра мог бы присвоить чужой вход.
  const { data: created, error: cErr } = await svc.auth.admin.createUser({
    email, password: randomPw(), email_confirm: true,
    app_metadata: { mglass_kind: 'partner', client_id: pm.client.id },
  })
  if (cErr || !created?.user) {
    const taken = /already|registered|exists/i.test(cErr?.message ?? '')
    return NextResponse.json({ error: taken ? 'Этот email уже зарегистрирован в M-Glass. Укажите другой или напишите нам' : `Учётка не создана: ${cErr?.message ?? 'нет ответа'}` }, { status: taken ? 409 : 500 })
  }
  const uid = created.user.id
  const rollback = async (msg: string) => {
    await svc.auth.admin.deleteUser(uid).catch(() => {})
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  // Роль партнёра ставит триггер по app_metadata; здесь — имя и проверка, что роль действительно partner.
  const { data: urow, error: uErr } = await svc.from('users').update({ name, role: 'partner' }).eq('id', uid).select('role').maybeSingle()
  if (uErr || (urow as { role?: string } | null)?.role !== 'partner') return rollback(`Не удалось выдать роль партнёра${uErr ? `: ${uErr.message}` : ''} — приглашение отменено`)
  const { error: pErr } = await svc.from('profiles').upsert({ user_id: uid, organization_id: PARTNER_ORG, role: 'partner' }, { onConflict: 'user_id' })
  if (pErr) return rollback(`Профиль не создан: ${pErr.message} — приглашение отменено`)
  const { data: me } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const { error: mErr } = await svc.from('b2b_client_members').insert({
    client_id: pm.client.id, user_id: uid, role, name, created_by: user.id,
    invited_by_name: (me as { name?: string } | null)?.name ?? null,
  })
  if (mErr) return rollback(`Сотрудник не добавлен: ${mErr.message}`)

  const token = await createSetupToken(uid)
  await writeLogForCurrentUser('partner.team.invite', { entityType: 'b2b_client', entityId: String(pm.client.id), details: { user_id: uid, role } }).catch(() => {})
  return NextResponse.json({ ok: true, userId: uid, link: `${appUrl()}/set-password?token=${token}`, roleLabel: TEAM_ROLE_RU[role] })
}

// Сменить роль или отключить/включить: { userId, role? , disabled? }.
export async function PATCH(req: NextRequest) {
  const c = await ctx()
  if ('error' in c) return c.error
  const blocked = await previewWriteGuard(c.svc, c.user.id)
  if (blocked) return blocked
  const { svc, pm, user } = c
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const target = String(body.userId ?? '')
  if (target === user.id) return NextResponse.json({ error: 'Свою роль и доступ меняет другой руководитель' }, { status: 400 })
  const m = await memberOf(svc, pm.client.id, target)
  if (!m) return NextResponse.json({ error: 'Это не сотрудник из команды (руководителя карточки меняет M-Glass)' }, { status: 404 })

  const patch: Record<string, unknown> = {}
  if (body.role !== undefined) {
    if (!isTeamRole(body.role)) return NextResponse.json({ error: 'Неизвестная роль' }, { status: 400 })
    patch.role = body.role
  }
  if (body.disabled !== undefined) patch.disabled_at = body.disabled ? new Date().toISOString() : null
  if (body.name !== undefined) {
    const n = cleanName(body.name)
    if (!n) return NextResponse.json({ error: 'Имя не может быть пустым' }, { status: 400 })
    patch.name = n
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Нечего менять' }, { status: 400 })

  if (patch.disabled_at === null && m.disabled_at) {
    const team = await loadTeam(svc, pm.client.id)
    const max = pm.client.max_members ?? 10
    if (seatsUsed(team) >= max) return NextResponse.json({ error: `Все ${max} мест заняты` }, { status: 409 })
  }

  const { data, error } = await svc.from('b2b_client_members').update(patch).eq('client_id', pm.client.id).eq('user_id', target).select('user_id')
  if (error) return NextResponse.json({ error: `Не сохранено: ${error.message}` }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Не сохранено: сотрудник не найден' }, { status: 404 })
  if (patch.name) await svc.from('users').update({ name: patch.name }).eq('id', target)
  // Отключённый теряет доступ со следующего запроса: резолвер кабинета проверяет disabled_at каждый раз.
  await writeLogForCurrentUser('partner.team.update', { entityType: 'b2b_client', entityId: String(pm.client.id), details: { user_id: target, ...patch } }).catch(() => {})
  return NextResponse.json({ ok: true })
}
