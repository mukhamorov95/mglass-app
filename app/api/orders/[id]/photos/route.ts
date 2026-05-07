import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { id } = await params
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Нет файла' }, { status: 400 })

  const client = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `order-photos/${id}/${Date.now()}.${ext}`
  const bytes = await file.arrayBuffer()

  const { error: uploadErr } = await client.storage
    .from('backups')
    .upload(path, bytes, { contentType: file.type, upsert: false })

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 })

  const { data: { publicUrl } } = client.storage.from('backups').getPublicUrl(path)

  // Append URL to completion_photos array
  const { data: order } = await client.from('orders').select('completion_photos').eq('id', id).single()
  const existing: string[] = (order as any)?.completion_photos ?? []
  await client.from('orders').update({ completion_photos: [...existing, publicUrl] }).eq('id', id)

  return NextResponse.json({ url: publicUrl })
}
