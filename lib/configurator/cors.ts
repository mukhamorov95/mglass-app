import { NextResponse } from 'next/server'

// Публичные маршруты конфигуратора вызывает сайт с ДРУГОГО домена. Без этих
// заголовков браузер отбрасывает ответ молча: сервер отвечает 200, а на сайте
// «не удалось посчитать». Открываем только чтение цены и приём заявки —
// себестоимости в этих ответах нет (её отдают лишь авторизованному).
const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
} as const

export function withCors<T>(body: T, init?: { status?: number }): NextResponse {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: HEADERS })
}

export function corsPreflight(): NextResponse {
  return new NextResponse(null, { status: 204, headers: HEADERS })
}
