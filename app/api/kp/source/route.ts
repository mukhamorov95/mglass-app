import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { isOwnSourcePath } from '@/lib/kp/sourceFile'

// Выдача исходного файла КП. Бакет приватный: ссылку подписываем на минуту и
// только после проверки, что этот файл человеку положен.
// Видит файл тот, кто его загрузил (свой КП ещё не сохранён), либо тот, кому
// виден сам КП — проверку «чей КП» делает RLS commercial_proposals: запрос идёт
// клиентом пользователя, менеджеру чужие строки просто не вернутся.
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const path = new URL(req.url).searchParams.get('path') ?? ''
  if (!path || path.includes('..')) return NextResponse.json({ error: 'bad path' }, { status: 400 })

  let allowed = isOwnSourcePath(path, user.id)
  if (!allowed) {
    const { data } = await sb.from('commercial_proposals')
      .select('id').eq('content->source_file->>path', path).limit(1)
    allowed = !!data?.length
  }
  if (!allowed) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const svc = createServiceClient()
  const { data, error } = await svc.storage.from('kp-sources').createSignedUrl(path, 60)
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
  }
  return NextResponse.redirect(data.signedUrl)
}
