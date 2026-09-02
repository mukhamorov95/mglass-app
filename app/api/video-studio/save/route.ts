import { NextRequest, NextResponse } from 'next/server'
import { requireOwner } from '@/lib/apiAuth'
import { writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

// Приём записанного ролика на диск.
//
// Без этого шага конвейер обрывался на последнем метре: студия писала видео в
// память вкладки, и достать его мог только человек нажатием «Скачать».
// Теперь запись сохраняется файлом, и собрать ролик можно целиком без человека.
//
// Кладём в var/video, а не в public: ролик — не статика сайта, он отдаётся
// адресно и не должен раздаваться всем по прямой ссылке.

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const guard = await requireOwner()
  if (guard instanceof NextResponse) return guard

  const name = req.nextUrl.searchParams.get('name') ?? ''
  if (!/^[a-z0-9-]{1,60}$/.test(name)) {
    return NextResponse.json({ error: 'Недопустимое имя' }, { status: 400 })
  }

  const buf = Buffer.from(await req.arrayBuffer())
  if (buf.length === 0) return NextResponse.json({ error: 'Пустая запись' }, { status: 400 })
  if (buf.length > 200 * 1024 * 1024) return NextResponse.json({ error: 'Слишком большой файл' }, { status: 413 })

  const dir = join(process.cwd(), 'var', 'video')
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${name}.webm`)
  await writeFile(file, buf)

  return NextResponse.json({ ok: true, path: `var/video/${name}.webm`, bytes: buf.length })
}
