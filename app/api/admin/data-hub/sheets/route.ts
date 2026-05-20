import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/lib/supabase-server'

function extractSheetId(input: string): string | null {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  if (/^[a-zA-Z0-9_-]{30,}$/.test(input.trim())) return input.trim()
  return null
}

export async function POST(req: NextRequest) {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const { url, gid = '0' } = await req.json()
  const sheetId = extractSheetId(url ?? '')
  if (!sheetId) return NextResponse.json({ error: 'Не удалось извлечь ID таблицы' }, { status: 400 })

  const exportUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`

  let text: string
  try {
    const res = await fetch(exportUrl, { redirect: 'follow' })
    if (!res.ok) return NextResponse.json({ error: `Google вернул ${res.status}. Убедись, что таблица открыта по ссылке.` }, { status: 400 })
    text = await res.text()
  } catch (e) {
    return NextResponse.json({ error: `Ошибка запроса: ${String(e)}` }, { status: 500 })
  }

  const rows = parseCSV(text)
  if (rows.length === 0) return NextResponse.json({ error: 'Таблица пустая' }, { status: 400 })

  return NextResponse.json({ sheetId, gid, rows, headers: rows[0], preview: rows.slice(1, 11) })
}

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  return lines.map(line => {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  })
}
