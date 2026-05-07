import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

const DEFAULT_CHECKLIST = [
  'Просчитать unit-экономику',
  'Сделать тестовую сборку',
  'Проверить монтаж',
  'Проверить упаковку',
  'Проверить доставку (хрупкость)',
  'Тест на повреждения при транспортировке',
  'Сделать фото продукта',
  'Снять видео (Reels/Shorts)',
  'Снять YouTube-обзор',
  'Сделать PDF-карточку товара',
  'Написать инструкцию по монтажу',
  'Добавить на сайт',
  'Сделать SEO-оптимизацию',
  'Создать продающий текст',
  'Сделать comparison с конкурентами',
  'Сделать FAQ',
  'Создать контент-план для запуска',
  'Оформить гарантийные условия',
  'Написать оффер для дизайнеров',
  'Написать оффер для B2B партнёров',
  'Разместить на маркетплейсе',
  'Запустить рекламу',
  'Сделать Reels с хуком',
  'Отправить блогерам на тест',
]

async function admin() {
  const s = await createClient()
  const { data: { user } } = await s.auth.getUser()
  if (!user) return null
  return s
}

export async function GET(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = new URL(req.url)
  const category = searchParams.get('category')
  const line_id = searchParams.get('line_id')
  const status = searchParams.get('status')
  const with_ue = searchParams.get('with_ue') === 'true'

  let q = s.from('product_skus')
    .select(with_ue ? '*, product_unit_economics(*)' : '*')
    .order('created_at', { ascending: false })

  if (category) q = q.eq('category', category)
  if (line_id) q = q.eq('line_id', parseInt(line_id))
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json()

  const { data: sku, error } = await s.from('product_skus').insert(body).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Auto-create unit economics record
  await s.from('product_unit_economics').insert({ sku_id: sku.id })

  // Auto-seed launch checklist
  await s.from('product_checklist_items').insert(
    DEFAULT_CHECKLIST.map((item, i) => ({ sku_id: sku.id, item, sort_order: i }))
  )

  return NextResponse.json(sku)
}

export async function PUT(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id, ...fields } = await req.json()
  const { error } = await s.from('product_skus').update(fields).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const s = await admin()
  if (!s) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await req.json()
  const { error } = await s.from('product_skus').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
