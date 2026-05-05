import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as adminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SRK  = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET = 'shower-models'

function admin() {
  return adminClient(URL, SRK)
}

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(URL, ANON, {
    cookies: { getAll: () => cookieStore.getAll() },
  })
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET /api/admin/shower-images → [{model_id, image_url}]
export async function GET() {
  const db = admin()
  const { data } = await db.from('shower_model_images').select('model_id,image_url')
  return NextResponse.json(data ?? [])
}

// POST /api/admin/shower-images  (multipart: modelId + file)
export async function POST(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: u } = await db.from('users').select('role').eq('id', user.id).single()
  if (u?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const form = await req.formData()
  const modelId = form.get('modelId') as string
  const file    = form.get('file') as File | null
  if (!modelId || !file) return NextResponse.json({ error: 'modelId + file required' }, { status: 400 })

  // Создаём бакет если нет
  const { data: buckets } = await db.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10_000_000 })
  }

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${modelId}.${ext}`
  const buf  = await file.arrayBuffer()

  const { error } = await db.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path)
  const url = `${publicUrl}?v=${Date.now()}`

  await db.from('shower_model_images').upsert({
    model_id: modelId, image_url: url, updated_at: new Date().toISOString(),
  })

  return NextResponse.json({ url })
}

// DELETE /api/admin/shower-images?modelId=M1
export async function DELETE(req: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = admin()
  const { data: u } = await db.from('users').select('role').eq('id', user.id).single()
  if (u?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const modelId = new globalThis.URL(req.url).searchParams.get('modelId')
  if (!modelId) return NextResponse.json({ error: 'modelId required' }, { status: 400 })

  await db.from('shower_model_images').delete().eq('model_id', modelId)
  return NextResponse.json({ ok: true })
}
