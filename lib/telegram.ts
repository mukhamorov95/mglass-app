const TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const API = `https://api.telegram.org/bot${TOKEN}`

export type InlineButton = { text: string; callback_data?: string; url?: string }
export type InlineKeyboard = InlineButton[][]

async function call(method: string, body: Record<string, unknown>) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

export function sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard) {
  return call('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

export function editMessage(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard) {
  return call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
  })
}

export function answerCallback(callbackQueryId: string, text?: string) {
  return call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) })
}

export function deleteMessage(chatId: number, messageId: number) {
  return call('deleteMessage', { chat_id: chatId, message_id: messageId })
}

export async function getFileUrl(fileId: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
    signal,
  })
  const json = await res.json() as any
  if (!json.ok) throw new Error(`tg_getFile_error: ${json.description ?? 'unknown'}`)
  return `https://api.telegram.org/file/bot${TOKEN}/${json.result.file_path}`
}

export async function downloadFile(fileId: string, signal?: AbortSignal): Promise<Buffer> {
  const url = await getFileUrl(fileId, signal)
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`tg_download_http_${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function getAdminIds(): Promise<number[]> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data } = await supabase
    .from('telegram_users')
    .select('telegram_id, users!inner(role)')
    .eq('users.role', 'admin')
  return (data ?? []).map((row: any) => row.telegram_id)
}

export async function notifyAdmins(text: string) {
  const ids = await getAdminIds()
  for (const id of ids) await sendMessage(id, text).catch(() => {})
}

export async function notifyAdminsWithKeyboard(text: string, keyboard: InlineKeyboard) {
  const ids = await getAdminIds()
  for (const id of ids) await sendMessage(id, text, keyboard).catch(() => {})
}

function voiceLog(step: string, data?: Record<string, unknown>) {
  const extra = data ? ' ' + JSON.stringify(data) : ''
  console.log(`[VOICE:${step}]${extra}`)
}

export async function transcribeVoice(fileId: string): Promise<string> {
  // ── Step 1: download from Telegram (15s budget) ──────────────────────────
  voiceLog('download_started', { fileId })
  const dlAbort = new AbortController()
  const dlTimer = setTimeout(() => { dlAbort.abort(); voiceLog('download_timeout') }, 15_000)

  let buffer: Buffer
  try {
    buffer = await downloadFile(fileId, dlAbort.signal)
    clearTimeout(dlTimer)
    voiceLog('download_finished', { bytes: buffer.length })
  } catch (e) {
    clearTimeout(dlTimer)
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    voiceLog('download_error', { abort: isAbort, msg })
    throw new Error(isAbort ? 'timeout:download' : `download_failed: ${msg}`)
  }

  // ── Step 2: check OpenAI key ─────────────────────────────────────────────
  if (!process.env.OPENAI_API_KEY) {
    voiceLog('error_no_openai_key')
    throw new Error('OPENAI_API_KEY not set')
  }

  // ── Step 3: send to Whisper (20s budget) ────────────────────────────────
  voiceLog('transcription_started', { bytes: buffer.length })
  const whAbort = new AbortController()
  const whTimer = setTimeout(() => { whAbort.abort(); voiceLog('transcription_timeout') }, 20_000)

  try {
    const formData = new FormData()
    // Telegram voice = OGG Opus; Whisper accepts ogg natively
    formData.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/ogg' }), 'voice.ogg')
    formData.append('model', 'whisper-1')
    formData.append('language', 'ru')

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
      signal: whAbort.signal,
    })
    clearTimeout(whTimer)

    if (!res.ok) {
      const errBody = await res.text().catch(() => '?')
      voiceLog('transcription_http_error', { status: res.status, body: errBody.slice(0, 200) })
      throw new Error(`whisper_http_${res.status}: ${errBody.slice(0, 120)}`)
    }

    const json = await res.json() as any
    const text: string = json.text ?? ''
    voiceLog('transcription_finished', { chars: text.length, preview: text.slice(0, 60) })

    if (!text) {
      voiceLog('transcription_empty', { response: JSON.stringify(json).slice(0, 200) })
    }
    return text
  } catch (e) {
    clearTimeout(whTimer)
    const msg = e instanceof Error ? e.message : String(e)
    const isAbort = e instanceof Error && e.name === 'AbortError'
    voiceLog('transcription_error', { abort: isAbort, msg })
    throw isAbort ? new Error('timeout:whisper') : e
  }
}

export const MAIN_MENU: InlineKeyboard = [
  [
    { text: '🧮 Рассчитать цену', callback_data: 'menu:calc' },
    { text: '📋 Мои лиды',       callback_data: 'menu:leads' },
  ],
  [
    { text: '💬 Написать клиенту', callback_data: 'menu:msg' },
    { text: '🧠 Задача AI',        callback_data: 'menu:train' },
  ],
]
