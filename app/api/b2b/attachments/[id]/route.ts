import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

// Выдаёт короткоживущую подписанную ссылку на вложение и редиректит на неё.
// Bucket b2b-attachments приватный, поэтому прямые publicUrl не работают (400).
// Путь берём из file_url: либо это уже путь (новые записи), либо старый publicUrl
// (вырезаем часть после /b2b-attachments/).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const attId = Number(id)
  if (!attId) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: att } = await svc.from('b2b_calculation_attachments').select('file_url').eq('id', attId).single()
  if (!att?.file_url) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const marker = '/b2b-attachments/'
  const raw = String(att.file_url)
  const path = raw.includes(marker) ? raw.slice(raw.indexOf(marker) + marker.length) : raw

  const { data: signed, error } = await svc.storage.from('b2b-attachments').createSignedUrl(path, 300)
  if (error || !signed?.signedUrl) return NextResponse.json({ error: 'Sign failed' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}
