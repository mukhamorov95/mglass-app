import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { createServiceClient } from '@/lib/supabase-service'

// Панель платных сервисов: список, живая проверка и правка цифр владельцем.
//
// Проверяем ТОЛЬКО бесплатными служебными запросами (список моделей, каналов,
// getMe). Ни один пробник ничего не генерирует и не отправляет: панель должна
// показывать расходы, а не создавать их.

export async function GET() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const svc = createServiceClient()
  const { data, error } = await svc.from('paid_services').select('*').order('sort').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ services: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard
  const body = await req.json().catch(() => ({}))
  const id = Number(body.id)
  if (!id) return NextResponse.json({ error: 'Нужен id' }, { status: 400 })

  // Только денежные и справочные поля. Ключи и статус проверки правятся не отсюда.
  const allowed = ['monthly_cost', 'currency', 'billing', 'next_payment', 'balance_note', 'critical', 'notes'] as const
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (k in body) patch[k] = body[k]

  const svc = createServiceClient()
  const { error } = await svc.from('paid_services').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

type Probe = { key: string; status: 'ok' | 'warn' | 'down' | 'off'; detail: string }

async function ping(url: string, headers: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
  } catch { return null }
}

export async function POST() {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const probes: Probe[] = []
  const env = (k: string) => process.env[k]

  // Claude: список моделей — бесплатный служебный запрос.
  const anth = env('ANTHROPIC_API_KEY')
  if (!anth) probes.push({ key: 'ANTHROPIC_API_KEY', status: 'off', detail: 'ключ не задан' })
  else {
    const r = await ping('https://api.anthropic.com/v1/models?limit=1', { 'x-api-key': anth, 'anthropic-version': '2023-06-01' })
    probes.push({ key: 'ANTHROPIC_API_KEY',
      status: r?.ok ? 'ok' : r?.status === 401 ? 'down' : 'warn',
      detail: r ? `HTTP ${r.status}` : 'нет ответа' })
  }

  // OpenAI: список моделей отвечает и при нулевом балансе — значит ключ жив,
  // а вот кончились ли кредиты, видно только при реальном вызове. Поэтому
  // отдельно отмечаем: ключ рабочий ≠ деньги есть.
  const oa = env('OPENAI_API_KEY')
  if (!oa) probes.push({ key: 'OPENAI_API_KEY', status: 'off', detail: 'ключ не задан' })
  else {
    const r = await ping('https://api.openai.com/v1/models', { Authorization: `Bearer ${oa}` })
    probes.push({ key: 'OPENAI_API_KEY',
      status: r?.ok ? 'ok' : r?.status === 429 ? 'warn' : r?.status === 401 ? 'down' : 'warn',
      detail: r ? (r.status === 429 ? 'HTTP 429 — кредиты кончились' : `HTTP ${r.status}`) : 'нет ответа' })
  }

  const tg = env('TELEGRAM_BOT_TOKEN')
  if (!tg) probes.push({ key: 'TELEGRAM_BOT_TOKEN', status: 'off', detail: 'ключ не задан' })
  else {
    const r = await ping(`https://api.telegram.org/bot${tg}/getMe`, {})
    probes.push({ key: 'TELEGRAM_BOT_TOKEN', status: r?.ok ? 'ok' : 'down', detail: r ? `HTTP ${r.status}` : 'нет ответа' })
  }

  const wz = env('WAZZUP_API_KEY')
  if (!wz) probes.push({ key: 'WAZZUP_API_KEY', status: 'off', detail: 'ключ не задан' })
  else {
    const r = await ping('https://api.wazzup24.com/v3/channels', { Authorization: `Bearer ${wz}` })
    probes.push({ key: 'WAZZUP_API_KEY', status: r?.ok ? 'ok' : r?.status === 401 ? 'down' : 'warn',
      detail: r ? `HTTP ${r.status}` : 'нет ответа' })
  }

  const rs = env('RESEND_API_KEY')
  if (!rs) probes.push({ key: 'RESEND_API_KEY', status: 'off', detail: 'ключ не задан' })
  else {
    const r = await ping('https://api.resend.com/domains', { Authorization: `Bearer ${rs}` })
    probes.push({ key: 'RESEND_API_KEY', status: r?.ok ? 'ok' : r?.status === 401 ? 'down' : 'warn',
      detail: r ? `HTTP ${r.status}` : 'нет ответа' })
  }

  // Supabase, AmoCRM, Avito, Vercel, Yandex — по наличию ключа: их служебные
  // проверки либо платные, либо меняют состояние, а панель не должна ничего трогать.
  for (const [key, envName] of [
    ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['AMO_ACCESS_TOKEN', 'AMO_ACCESS_TOKEN'],
    ['AVITO_CLIENT_SECRET', 'AVITO_CLIENT_SECRET'],
  ] as const) {
    probes.push({ key, status: env(envName) ? 'ok' : 'off', detail: env(envName) ? 'ключ задан' : 'ключ не задан' })
  }

  const svc = createServiceClient()
  const now = new Date().toISOString()
  for (const p of probes) {
    await svc.from('paid_services').update({ status: p.status, checked_at: now, balance_note: p.detail }).eq('key', p.key)
  }
  return NextResponse.json({ ok: true, checked: probes.length, probes })
}
