'use server'

import { revalidatePath } from 'next/cache'
import { serviceAsMe } from '@/lib/serviceAs'
import { getSessionUser } from '@/lib/getRole'
import { PLATFORMS, utmFor, type Platform } from '@/lib/marketing/publications'
import { requireMarketing } from '../MarketingTabs'

export type ActionState = { ok: boolean; message: string } | null

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim()

function httpsUrl(v: string): string | null {
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export async function createObject(_: ActionState, f: FormData): Promise<ActionState> {
  await requireMarketing()
  const slug = str(f, 'slug').toLowerCase()
  const title = str(f, 'title')
  if (!/^[a-z0-9-]{3,60}$/.test(slug)) return { ok: false, message: 'Метка — латиница, цифры и дефис, например zhk-sobytie' }
  if (!title) return { ok: false, message: 'Нужно название: ЖК или тип объекта' }
  const pageRaw = str(f, 'page_url')
  const page_url = pageRaw ? httpsUrl(pageRaw) : null
  if (pageRaw && !page_url) return { ok: false, message: 'Адрес страницы должен начинаться с https://' }
  const user = await getSessionUser()
  const db = await serviceAsMe()
  const { data, error } = await db
    .from('content_objects')
    .insert({ slug, title, product: str(f, 'product') || null, district: str(f, 'district') || null, page_url, status: page_url ? 'published' : 'draft', created_by: user?.id ?? null })
    .select('id')
  if (error) return { ok: false, message: error.code === '23505' ? `Метка ${slug} уже занята` : `Не сохранено: ${error.message}` }
  if (!data?.length) return { ok: false, message: 'Не сохранено: база не вернула запись' }
  revalidatePath('/marketing/objects')
  return { ok: true, message: `Объект «${title}» добавлен — он в списке ниже, следующий шаг: добавить публикацию` }
}

export async function createPublication(_: ActionState, f: FormData): Promise<ActionState> {
  await requireMarketing()
  const objectId = str(f, 'object_id')
  const platform = str(f, 'platform') as Platform
  if (!PLATFORMS.some((p) => p.key === platform)) return { ok: false, message: 'Выберите площадку' }
  const db = await serviceAsMe()
  const { data: obj, error: oErr } = await db.from('content_objects').select('slug, page_url').eq('id', objectId).maybeSingle()
  if (oErr) return { ok: false, message: `Не удалось прочитать объект: ${oErr.message}` }
  if (!obj) return { ok: false, message: 'Объект не найден — обновите страницу' }
  const target_url = httpsUrl(str(f, 'target_url') || obj.page_url || '')
  if (!target_url) return { ok: false, message: 'Нужна ссылка на страницу сайта, куда ведёт публикация (https://…)' }
  const urlRaw = str(f, 'url')
  const url = urlRaw ? httpsUrl(urlRaw) : null
  if (urlRaw && !url) return { ok: false, message: 'Ссылка на пост должна начинаться с https://' }
  const id = crypto.randomUUID()
  const user = await getSessionUser()
  const { data, error } = await db
    .from('content_publications')
    .insert({ id, object_id: objectId, platform, url, target_url, ...utmFor(platform, obj.slug, id), status: url ? 'published' : 'draft', published_at: url ? new Date().toISOString().slice(0, 10) : null, created_by: user?.id ?? null })
    .select('id')
  if (error) return { ok: false, message: `Не сохранено: ${error.message}` }
  if (!data?.length) return { ok: false, message: 'Не сохранено: база не вернула запись' }
  revalidatePath('/marketing/objects')
  return { ok: true, message: url ? 'Публикация записана как опубликованная' : 'Черновик публикации добавлен — скопируйте ссылку с UTM в пост, после выхода вставьте ссылку на пост' }
}

export async function markPublished(_: ActionState, f: FormData): Promise<ActionState> {
  await requireMarketing()
  const url = httpsUrl(str(f, 'url'))
  if (!url) return { ok: false, message: 'Вставьте ссылку на вышедший пост (https://…)' }
  const date = str(f, 'published_at') || new Date().toISOString().slice(0, 10)
  const db = await serviceAsMe()
  const { data, error } = await db.from('content_publications').update({ url, status: 'published', published_at: date }).eq('id', str(f, 'id')).select('id')
  if (error) return { ok: false, message: `Не сохранено: ${error.message}` }
  if (!data?.length) return { ok: false, message: 'Не сохранено: публикация не найдена' }
  revalidatePath('/marketing/objects')
  return { ok: true, message: 'Отмечено: опубликовано' }
}
