// Речь → текст (русский). Основной провайдер — OpenAI Whisper. Если у него
// кончилась квота/оплата (HTTP 402/429) и задан GROQ_API_KEY — падаем на Groq
// Whisper (бесплатный тариф, тот же API-формат). Общий модуль для всех голосовых
// фич (монтаж, КП, бухгалтерия, разбор звонков) — чтобы биллинг одного провайдера
// не рушил диктовку молча.

export type TranscribeResult =
  | { ok: true; text: string; provider: 'openai' | 'groq' }
  | { ok: false; status: number; code: TranscribeError; message: string }

export type TranscribeError = 'quota' | 'auth' | 'provider' | 'timeout' | 'no_key' | 'empty'

const MESSAGES: Record<TranscribeError, string> = {
  quota:    'Закончилась квота OpenAI — пополните баланс на platform.openai.com (или добавьте бесплатный GROQ_API_KEY)',
  auth:     'Неверный ключ распознавания речи (OPENAI_API_KEY/GROQ_API_KEY)',
  provider: 'Сервис распознавания речи временно недоступен',
  timeout:  'Распознавание заняло слишком долго — попробуйте запись короче',
  no_key:   'Распознавание речи не настроено (нет OPENAI_API_KEY/GROQ_API_KEY)',
  empty:    'Пустая запись — ничего не распозналось',
}

const fail = (status: number, code: TranscribeError): TranscribeResult =>
  ({ ok: false, status, code, message: MESSAGES[code] })

async function whisperCall(endpoint: string, key: string, model: string, file: Blob, filename: string) {
  const form = new FormData()
  form.append('file', file, filename)
  form.append('model', model)
  form.append('language', 'ru')
  return fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  })
}

async function readText(r: Response): Promise<string> {
  const j = await r.json().catch(() => ({})) as { text?: string }
  return (j.text ?? '').trim()
}

export async function transcribeRu(file: Blob, filename: string): Promise<TranscribeResult> {
  const openaiKey = process.env.OPENAI_API_KEY
  const groqKey   = process.env.GROQ_API_KEY
  if (!openaiKey && !groqKey) return fail(500, 'no_key')

  let quotaHit = false

  // 1) OpenAI Whisper (основной)
  if (openaiKey) {
    try {
      const r = await whisperCall('https://api.openai.com/v1/audio/transcriptions', openaiKey, 'whisper-1', file, filename)
      if (r.ok) {
        const text = await readText(r)
        return text ? { ok: true, text, provider: 'openai' } : fail(400, 'empty')
      }
      // Квота/оплата — есть смысл попробовать запасной провайдер.
      if (r.status === 429 || r.status === 402) quotaHit = true
      else if (r.status === 401 || r.status === 403) { if (!groqKey) return fail(r.status, 'auth') }
      else if (!groqKey) return fail(r.status, 'provider')
    } catch {
      if (!groqKey) return fail(504, 'timeout')
    }
  }

  // 2) Groq Whisper (запасной / основной, если нет ключа OpenAI)
  if (groqKey) {
    try {
      const r = await whisperCall('https://api.groq.com/openai/v1/audio/transcriptions', groqKey, 'whisper-large-v3-turbo', file, filename)
      if (r.ok) {
        const text = await readText(r)
        return text ? { ok: true, text, provider: 'groq' } : fail(400, 'empty')
      }
      if (r.status === 401 || r.status === 403) return fail(r.status, 'auth')
      return fail(r.status, r.status === 429 || r.status === 402 ? 'quota' : 'provider')
    } catch {
      return fail(504, 'timeout')
    }
  }

  // Сюда попадаем только если OpenAI упал по квоте, а Groq-ключа нет.
  return fail(quotaHit ? 429 : 502, 'quota')
}
