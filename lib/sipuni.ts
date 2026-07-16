// SIPUNI click-to-call: инициирует обратный звонок «сначала менеджеру, потом клиенту».
// Ключ и аккаунт — из env (SIPUNI_API_KEY / SIPUNI_ID), в коде секрет не хранится.
// Спецификация: sipuni.com/api/callback/call_number, hash — md5 значений в
// алфавитном порядке имён параметров через '+' плюс секретный ключ.

import { createHash } from 'crypto'

const SIPUNI_ID  = process.env.SIPUNI_ID              // номер аккаунта (кабинет), напр. 093181
const SIPUNI_KEY = process.env.SIPUNI_API_KEY         // ключ интеграции
const SIPUNI_DEFAULT_EXT = process.env.SIPUNI_DEFAULT_SIPNUMBER // внутренний номер по умолчанию (напр. 201)

export function isSipuniConfigured(): boolean {
  return !!(SIPUNI_ID && SIPUNI_KEY)
}

export function defaultSipNumber(): string | null {
  return SIPUNI_DEFAULT_EXT ?? null
}

// Нормализация номера РФ → 7XXXXXXXXXX
export function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1)
  else if (d.length === 10) d = '7' + d
  return d
}

export type SipuniCallResult = { ok: boolean; status: number; body: string }

export async function sipuniCallNumber(
  phone: string,
  sipnumber: string,
  opts: { reverse?: '0' | '1'; antiaon?: '0' | '1' } = {},
): Promise<SipuniCallResult> {
  if (!isSipuniConfigured()) throw new Error('SIPUNI не настроен (нет SIPUNI_ID / SIPUNI_API_KEY)')
  const user = SIPUNI_ID!
  const secret = SIPUNI_KEY!
  const reverse = opts.reverse ?? '0'   // 0 — сначала звоним менеджеру, затем клиенту
  const antiaon = opts.antiaon ?? '0'
  const cleanPhone = normalizePhone(phone)

  // Порядок склейки — алфавитный по именам: antiaon, phone, reverse, sipnumber, user
  const hashString = [antiaon, cleanPhone, reverse, sipnumber, user, secret].join('+')
  const hash = createHash('md5').update(hashString).digest('hex')

  const body = new URLSearchParams({ antiaon, phone: cleanPhone, reverse, sipnumber, user, hash })
  const res = await fetch('https://sipuni.com/api/callback/call_number', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const text = await res.text()
  return { ok: res.ok, status: res.status, body: text }
}
