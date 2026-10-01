import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { resolvePartnerClient } from '@/lib/partnerClient'
import { previewWriteGuard } from '@/lib/partnerPreview'
import { parseNotes } from '@/lib/orderFlags'
import { checkDrawingFile, isDrawingKind, storagePath } from '@/lib/partner/drawingFiles'

// Ч1: чертежи и эскизы к просчёту партнёра. Бакет b2b-attachments партнёру
// закрыт (Ч0), поэтому пишем и читаем service-role'ом после проверки, что заказ
// принадлежит компании партнёра. Открывается файл через /api/b2b/attachments/[id].

type Ctx = { params: Promise<{ id: string }> }
type Row = { id: string; file_name: string; file_size: number | null; kind: string | null; uploaded_by: string | null; created_at: string }

async function loadOwnOrder(ctx: Ctx) {
  const oid = Number((await ctx.params).id)
  if (!Number.isInteger(oid) || oid <= 0) return { ok: false as const, error: NextResponse.json({ error: 'Плохой id' }, { status: 400 }) }
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: NextResponse.json({ error: 'Не авторизован' }, { status: 401 }) }
  const svc = createServiceClient()
  const client = await resolvePartnerClient<{ id: number }>(svc, user.id)
  if (!client) return { ok: false as const, error: NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 }) }
  const { data: order } = await svc.from('b2b_orders').select('id,client_id,launched_at,notes').eq('id', oid).maybeSingle()
  const o = order as { client_id: number | null; launched_at: string | null; notes: string | null } | null
  if (!o || o.client_id !== client.id) return { ok: false as const, error: NextResponse.json({ error: 'Просчёт не найден' }, { status: 404 }) }
  const launched = !!(o.launched_at || parseNotes(o.notes ?? null).launched_at)
  return { ok: true as const, oid, user, svc, clientId: client.id, launched }
}

const view = (r: Row, launched: boolean) => ({
  id: r.id, name: r.file_name, size: r.file_size, kind: r.kind, createdAt: r.created_at,
  url: `/api/b2b/attachments/${r.id}`,
  canDelete: !launched && (r.uploaded_by ?? '').startsWith('partner:'),
})

async function listFiles(svc: ReturnType<typeof createServiceClient>, oid: number): Promise<Row[]> {
  const { data } = await svc.from('b2b_calculation_attachments')
    .select('id,file_name,file_size,kind,uploaded_by,created_at').eq('order_id', oid).order('created_at')
  return (data ?? []) as Row[]
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const r = await loadOwnOrder(ctx)
  if (!r.ok) return r.error
  const rows = await listFiles(r.svc, r.oid)
  return NextResponse.json({ launched: r.launched, files: rows.map(x => view(x, r.launched)) })
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const r = await loadOwnOrder(ctx)
  if (!r.ok) return r.error
  const blocked = await previewWriteGuard(r.svc, r.user.id, { allowOnTest: true })
  if (blocked) return blocked
  if (r.launched) return NextResponse.json({ error: 'Заказ уже в работе — файл передайте менеджеру' }, { status: 400 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const kind = form?.get('kind')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Файл не получен' }, { status: 400 })
  if (!isDrawingKind(kind)) return NextResponse.json({ error: 'Не указано, чертёж это или эскиз' }, { status: 400 })

  const bytes = new Uint8Array(await file.arrayBuffer())
  const existing = await listFiles(r.svc, r.oid)
  const check = checkDrawingFile(bytes.subarray(0, 16), bytes.byteLength, existing.length)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })

  const name = (file instanceof File && file.name ? file.name : 'file').slice(0, 120)
  const path = storagePath(r.clientId, r.oid, name, check.mime)
  const { error: upErr } = await r.svc.storage.from('b2b-attachments').upload(path, bytes, { contentType: check.mime, upsert: false })
  if (upErr) return NextResponse.json({ error: `Файл не загрузился: ${upErr.message}` }, { status: 500 })

  const { data: row, error: insErr } = await r.svc.from('b2b_calculation_attachments').insert({
    order_id: r.oid, file_name: name, file_url: path, file_type: check.mime, file_size: bytes.byteLength,
    kind, uploaded_by: `partner:${r.user.id}`,
  }).select('id,file_name,file_size,kind,uploaded_by,created_at').single()
  if (insErr || !row) {
    await r.svc.storage.from('b2b-attachments').remove([path])
    return NextResponse.json({ error: `Файл не привязался к просчёту: ${insErr?.message ?? 'нет ответа'}` }, { status: 500 })
  }
  return NextResponse.json({ file: view(row as Row, false) })
}

export async function DELETE(req: Request, ctx: Ctx): Promise<NextResponse> {
  const r = await loadOwnOrder(ctx)
  if (!r.ok) return r.error
  const blocked = await previewWriteGuard(r.svc, r.user.id, { allowOnTest: true })
  if (blocked) return blocked
  if (r.launched) return NextResponse.json({ error: 'Заказ уже в работе — файлы не удаляются' }, { status: 400 })

  const fileId = new URL(req.url).searchParams.get('file') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  const { data } = await r.svc.from('b2b_calculation_attachments')
    .select('id,file_url,uploaded_by').eq('id', fileId).eq('order_id', r.oid).maybeSingle()
  const att = data as { id: string; file_url: string; uploaded_by: string | null } | null
  if (!att) return NextResponse.json({ error: 'Файл не найден' }, { status: 404 })
  if (!(att.uploaded_by ?? '').startsWith('partner:')) return NextResponse.json({ error: 'Этот файл приложил менеджер — удалить его может только он' }, { status: 403 })

  const { data: gone, error } = await r.svc.from('b2b_calculation_attachments').delete().eq('id', att.id).select('id')
  if (error || !gone?.length) return NextResponse.json({ error: `Файл не удалён: ${error?.message ?? 'нет строки'}` }, { status: 500 })
  await r.svc.storage.from('b2b-attachments').remove([att.file_url])
  return NextResponse.json({ ok: true })
}
