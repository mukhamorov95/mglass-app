import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/apiAuth'
import { FIN_ROLES } from '@/lib/accounting/roles'
import { createServiceClient } from '@/lib/supabase-service'

// Б8: скан/квитанция к операции ДДС. Бакет приватный (тот же, что у заявок),
// поэтому файл отдаём подписанной ссылкой на 5 минут, а не публичным URL.

const BUCKET = 'b2b-attachments'
const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const form = await req.formData().catch(() => null)
  const file = form?.get('file') as File | null
  const entryId = Number(form?.get('entry_id'))
  if (!file || !(entryId > 0)) return NextResponse.json({ error: 'Нужен файл и операция' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Файл больше 15 МБ' }, { status: 400 })

  const safe = (file.name || 'file').replace(/[^\w.\-А-Яа-яЁё]+/g, '_').slice(-80)
  const path = `dds/${entryId}/${Date.now()}_${safe}`

  const svc = createServiceClient()
  const { error: upErr } = await svc.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { error } = await svc.from('cashflow_entries')
    .update({ attachment_path: path, updated_at: new Date().toISOString() }).eq('id', entryId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, path })
}

export async function GET(req: NextRequest) {
  const guard = await requireRole([...FIN_ROLES])
  if (guard instanceof NextResponse) return guard

  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!(id > 0)) return NextResponse.json({ error: 'Нет операции' }, { status: 400 })

  const svc = createServiceClient()
  const { data } = await svc.from('cashflow_entries').select('attachment_path').eq('id', id).maybeSingle()
  const path = (data as { attachment_path?: string } | null)?.attachment_path
  if (!path) return NextResponse.json({ error: 'Вложения нет' }, { status: 404 })

  const { data: signed } = await svc.storage.from(BUCKET).createSignedUrl(path, 300)
  if (!signed) return NextResponse.json({ error: 'Ссылка не создалась' }, { status: 500 })
  return NextResponse.redirect(signed.signedUrl)
}
