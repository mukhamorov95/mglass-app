import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'

// Загрузка фото/чертежа изделия для КП (лист 3 «СХЕМА КОМПЛЕКТАЦИИ»).
// Пишем сервисным клиентом в публичный bucket kp-photos: политики на заливку
// (storage.objects INSERT) для этого бакета нет, а прямая загрузка из браузера
// упирается в RLS и молча падает. Здесь RLS обходится, доступ ограничен авторизацией.
// PDF конвертируется в PNG на клиенте — сюда приходит только картинка.
export const runtime = 'nodejs'

const MAX = 10 * 1024 * 1024

export async function POST(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Файл не передан' }, { status: 400 })
  if (!file.type.startsWith('image/')) return NextResponse.json({ error: 'Только изображение' }, { status: 415 })
  if (file.size > MAX) return NextResponse.json({ error: 'Файл больше 10 МБ' }, { status: 413 })

  const ext = (file.name.split('.').pop() || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buf = Buffer.from(await file.arrayBuffer())

  const svc = createServiceClient()
  const { error } = await svc.storage.from('kp-photos').upload(path, buf, { contentType: file.type, upsert: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data } = svc.storage.from('kp-photos').getPublicUrl(path)
  return NextResponse.json({ url: data.publicUrl })
}
