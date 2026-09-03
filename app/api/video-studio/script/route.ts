import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Сценарий ролика лежит файлом в репозитории: его правят и ревьюят как код,
// а не как запись в базе. Имя проверяем строго — путь собирается из него.
export async function GET(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const name = req.nextUrl.searchParams.get('name') ?? ''
  if (!/^[a-z0-9-]{1,60}$/.test(name)) {
    return NextResponse.json({ error: 'Недопустимое имя' }, { status: 400 })
  }
  try {
    const raw = await readFile(join(process.cwd(), 'content', 'video', `${name}.json`), 'utf8')
    return NextResponse.json(JSON.parse(raw))
  } catch {
    return NextResponse.json({ error: 'Сценарий не найден' }, { status: 404 })
  }
}
