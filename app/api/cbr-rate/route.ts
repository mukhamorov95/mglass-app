import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const res  = await fetch('https://www.cbr-xml-daily.ru/daily_json.js', { next: { revalidate: 3600 } })
    const data = await res.json()
    return NextResponse.json({ rate: data.Valute.USD.Value, date: data.Date })
  } catch {
    return NextResponse.json({ rate: 82, date: new Date().toISOString(), error: true })
  }
}
