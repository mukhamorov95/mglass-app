import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { denyUnless, resolvePartnerMember } from '@/lib/partnerClient'
import { previewWriteGuard } from '@/lib/partnerPreview'
import { isOwnerRole } from '@/lib/getRole'
import { checkDrawingFile } from '@/lib/partner/drawingFiles'
import { writeLogForCurrentUser } from '@/lib/activityLog'

// Платёжное поручение к объединённому счёту (владелец 25.11.2026). Клиент прикладывает PDF или
// фото — у него и у нас счёт помечается «платёжка приложена». Оплатой счёт делают деньги:
// выписка банка находит счёт по номеру и сумме и раскладывает оплату по заказам.
// Бакет b2b-attachments партнёру закрыт: пишем и отдаём service-role'ом после проверки владельца счёта.

type Ctx = { params: Promise<{ id: string }> }
const STAFF = ['admin', 'ceo', 'cfo', 'accountant', 'commercial', 'manager']

async function invoiceOf(svc: ReturnType<typeof createServiceClient>, id: number) {
  const { data } = await svc.from('invoices').select('id, invoice_no, payer_client_id, status, payment_doc_path, payment_doc_name').eq('id', id).maybeSingle()
  return data as { id: number; invoice_no: string; payer_client_id: number | null; status: string; payment_doc_path: string | null; payment_doc_name: string | null } | null
}

export async function POST(req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const pm = await resolvePartnerMember<{ id: number; name: string }>(svc, user.id, 'id,name')
  if (!pm) return NextResponse.json({ error: 'Аккаунт не привязан' }, { status: 403 })
  { const denied = denyUnless(pm.role, 'finance'); if (denied) return denied }
  const blocked = await previewWriteGuard(svc, user.id, { allowOnTest: true })
  if (blocked) return blocked
  const inv = await invoiceOf(svc, id)
  if (!inv || inv.payer_client_id !== pm.client.id || inv.status === 'cancelled') return NextResponse.json({ error: 'Счёт не найден' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) return NextResponse.json({ error: 'Файл не получен' }, { status: 400 })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const check = checkDrawingFile(bytes.subarray(0, 16), bytes.byteLength, 0)
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 })
  const ext = check.mime === 'application/pdf' ? 'pdf' : check.mime.split('/')[1]
  const path = `invoices/${id}/${Date.now()}_payment.${ext}`
  const name = (file instanceof File && file.name ? file.name : `платёжка.${ext}`).slice(0, 120)
  const { error: upErr } = await svc.storage.from('b2b-attachments').upload(path, bytes, { contentType: check.mime, upsert: false })
  if (upErr) return NextResponse.json({ error: `Файл не сохранён: ${upErr.message}` }, { status: 500 })

  const { data: me } = await svc.from('users').select('name').eq('id', user.id).maybeSingle()
  const at = new Date().toISOString()
  const { data: done, error } = await svc.from('invoices').update({
    payment_doc_path: path, payment_doc_name: name, payment_doc_at: at,
    payment_doc_by: `${(me?.name as string | undefined) || pm.client.name} (кабинет)`, updated_at: at,
  }).eq('id', id).select('id')
  if (error || !done?.length) {
    await svc.storage.from('b2b-attachments').remove([path])
    return NextResponse.json({ error: `Платёжка не привязана к счёту${error ? `: ${error.message}` : ''}` }, { status: 500 })
  }
  if (inv.payment_doc_path) await svc.storage.from('b2b-attachments').remove([inv.payment_doc_path]).catch(() => {})
  await writeLogForCurrentUser('partner.invoice.payment_doc', { entityType: 'invoice', entityId: String(id), details: { name } }).catch(() => {})
  return NextResponse.json({ ok: true, name, at })
}

// Открыть платёжку: клиенту — по своему счёту, нам — финконтуру и менеджерам.
export async function GET(_req: Request, ctx: Ctx) {
  const id = Number((await ctx.params).id)
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Плохой id' }, { status: 400 })
  const sb = await createServerClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  const svc = createServiceClient()
  const inv = await invoiceOf(svc, id)
  if (!inv?.payment_doc_path) return NextResponse.json({ error: 'Платёжки нет' }, { status: 404 })
  const { data: u } = await svc.from('users').select('role').eq('id', user.id).maybeSingle()
  const role = (u?.role as string | undefined) ?? ''
  let allowed = isOwnerRole(role) || STAFF.includes(role)
  if (!allowed) {
    const pm = await resolvePartnerMember<{ id: number }>(svc, user.id)
    allowed = !!pm && pm.client.id === inv.payer_client_id && !denyUnless(pm.role, 'finance')
  }
  if (!allowed) return NextResponse.json({ error: 'Платёжки нет' }, { status: 404 })
  const { data, error } = await svc.storage.from('b2b-attachments').download(inv.payment_doc_path)
  if (error || !data) return NextResponse.json({ error: `Файл не прочитан: ${error?.message ?? 'пусто'}` }, { status: 500 })
  return new NextResponse(data, {
    headers: {
      'Content-Type': data.type || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(inv.payment_doc_name ?? 'платёжка')}`,
      'Cache-Control': 'private, no-store',
    },
  })
}
