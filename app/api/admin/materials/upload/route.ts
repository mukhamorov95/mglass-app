import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { createClient as adminClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON   = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SRK    = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET = 'material-images'

function admin() {
  return adminClient(SB_URL, SRK)
}

async function getUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(SB_URL, ANON, {
    cookies: { getAll: () => cookieStore.getAll() },
  })
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function checkAdmin() {
  const user = await getUser()
  if (!user) return null
  const db = admin()
  const { data: u } = await db.from('users').select('role').eq('id', user.id).single()
  return u?.role === 'admin' ? user : null
}

// POST /api/admin/materials/upload  (multipart: materialId + file)
export async function POST(req: Request) {
  const user = await checkAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = admin()
  const form = await req.formData()
  const materialId = form.get('materialId') as string
  const file       = form.get('file') as File | null
  if (!materialId || !file) return NextResponse.json({ error: 'materialId + file required' }, { status: 400 })

  // Создаём бакет если нет
  const { data: buckets } = await db.storage.listBuckets()
  if (!buckets?.find(b => b.name === BUCKET)) {
    await db.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 10_000_000 })
  }

  const ext  = file.name.split('.').pop() ?? 'jpg'
  const path = `${materialId}.${ext}`
  const buf  = await file.arrayBuffer()

  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: file.type, upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path)
  const url = `${publicUrl}?v=${Date.now()}`

  const { error: dbError } = await db.from('materials')
    .update({ image_url: url })
    .eq('id', Number(materialId))

  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 })

  return NextResponse.json({ url })
}

// DELETE /api/admin/materials/upload?materialId=123
export async function DELETE(req: Request) {
  const user = await checkAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const db = admin()
  const materialId = new globalThis.URL(req.url).searchParams.get('materialId')
  if (!materialId) return NextResponse.json({ error: 'materialId required' }, { status: 400 })

  await db.from('materials').update({ image_url: null }).eq('id', Number(materialId))
  return NextResponse.json({ ok: true })
}
