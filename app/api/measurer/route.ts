import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { notifyAdmins } from '@/lib/telegram'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const formData = await req.formData()
  const client_name  = (formData.get('client_name') as string)?.trim()
  const address      = (formData.get('address')     as string)?.trim()
  const phone        = (formData.get('phone')       as string)?.trim()
  const product_type = (formData.get('product_type') as string) ?? 'other'
  const dimensions   = formData.get('dimensions')   as string
  const notes        = (formData.get('notes')       as string)?.trim()
  const photoFiles   = formData.getAll('photos') as File[]

  if (!client_name) return NextResponse.json({ error: 'Укажите имя клиента' }, { status: 400 })
  if (!address)     return NextResponse.json({ error: 'Укажите адрес' }, { status: 400 })

  const service = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Upload photos
  const photoUrls: string[] = []
  for (const file of photoFiles) {
    if (!(file instanceof File)) continue
    const ext  = file.name.split('.').pop() ?? 'jpg'
    const path = `measurements/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
    const bytes = await file.arrayBuffer()
    const { error: uploadErr } = await service.storage
      .from('backups')
      .upload(path, bytes, { contentType: file.type, upsert: false })
    if (!uploadErr) {
      const { data: { publicUrl } } = service.storage.from('backups').getPublicUrl(path)
      photoUrls.push(publicUrl)
    }
  }

  const { data, error } = await service.from('measurements').insert({
    client_name,
    address,
    phone:        phone || null,
    product_type,
    dimensions:   dimensions ? JSON.parse(dimensions) : null,
    photos:       photoUrls,
    notes:        notes || null,
    submitted_by: user.id,
  }).select().single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Notify admins
  const dimParsed = dimensions ? JSON.parse(dimensions) : {}
  const dimText   = [dimParsed.width, dimParsed.height, dimParsed.depth].filter(Boolean).join(' × ')
  await notifyAdmins(
    `📐 <b>Новый замер</b>\n\n` +
    `Клиент: ${client_name}${phone ? ` · ${phone}` : ''}\n` +
    `Адрес: ${address}\n` +
    `Изделие: ${product_type}${dimText ? ` · ${dimText} мм` : ''}\n` +
    (notes ? `Заметки: ${notes}\n` : '') +
    (photoUrls.length ? `📷 Фото: ${photoUrls.length}` : ''),
  ).catch(() => {})

  return NextResponse.json({ ok: true, id: data.id })
}
