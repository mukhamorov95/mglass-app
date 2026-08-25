import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase-service'
import { getRole } from '@/lib/getRole'

// Ссылка на оригинал прайса (бакет приватный — отдаём подписанную ссылку на 10 минут).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const role = await getRole()
  if (!role) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const { id } = await params

  const supa = createServiceClient()
  const { data: list } = await supa.from('glass_price_lists').select('file_path, file_name').eq('id', id).maybeSingle()
  if (!list?.file_path) return NextResponse.json({ error: 'файл не найден' }, { status: 404 })

  // без download — прайс открывается на просмотр во вкладке, а не падает в загрузки
  const { data, error } = await supa.storage.from('b2b-attachments').createSignedUrl(list.file_path, 600)
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'ссылка не создана' }, { status: 500 })
  return NextResponse.json({ url: data.signedUrl, file_name: list.file_name })
}
