import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase-server'
import { logDrawingParse } from '@/lib/ai/parseLog'
import { requirePageAccess } from '@/lib/apiAuth'
import { parseShowerDrawing } from '@/lib/ai/showerDrawing'

// Чертёж душевой → параметры «Расчёта» с доказательством на каждое поле (Ч2).
// Ответ — только прочитанное; перевод в расчёт и остановки делает lib/calc/drawingParse.ts.
export const maxDuration = 120

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

export async function POST(req: Request) {
  const guard = await requirePageAccess('/calculator/build')
  if (guard instanceof NextResponse) return guard

  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const startedAt = Date.now()
  const { data: prof } = await sb.from('users').select('name').eq('id', user.id).maybeSingle()
  const who = (prof as { name: string | null } | null)?.name ?? user.email ?? null
  const note = (ok: boolean, extra: Partial<Parameters<typeof logDrawingParse>[0]> = {}) =>
    logDrawingParse({ route: 'ai/parse-shower-drawing', userId: user.id, userName: who, durationMs: Date.now() - startedAt, ok, ...extra })

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const fileMeta = { name: file.name, type: file.type, size: file.size }
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''
  const isPdf = type.includes('pdf') || name.endsWith('.pdf')
  const imgType = (['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const).find(t => t === type)
    ?? (/\.png$/.test(name) ? 'image/png' : /\.webp$/.test(name) ? 'image/webp' : /\.jpe?g$/.test(name) ? 'image/jpeg' : null)
  if (!isPdf && !imgType) {
    await note(false, { file: fileMeta, error: 'unsupported' })
    return NextResponse.json({ error: 'unsupported', detail: 'PDF или фото чертежа (JPG, PNG, WEBP).' }, { status: 415 })
  }
  const data = Buffer.from(await file.arrayBuffer()).toString('base64')
  const media = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: imgType!, data } }

  const r = await parseShowerDrawing(anthropic, media)
  if (!r.ok) {
    await note(false, { file: fileMeta, error: [r.error, r.stopReason && `stop=${r.stopReason}`, r.outputTokens && `out=${r.outputTokens}`, r.tail].filter(Boolean).join(' · ').slice(0, 600) })
    return NextResponse.json({ error: r.fatal ? 'ai_unavailable' : 'parse_failed', detail: r.fatal ? 'ИИ-разбор недоступен (ключ или баланс) — сообщите владельцу.' : 'Чертёж не разобран — введите размеры вручную.' }, { status: 502 })
  }
  await note(true, { file: fileMeta, itemsFound: r.parsed.showers.length })
  return NextResponse.json({ parsed: r.parsed, model: r.model })
}
