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

export async function getFileUrl(fileId: string): Promise<string> {
  const res = await call('getFile', { file_id: fileId }) as any
  return `https://api.telegram.org/file/bot${TOKEN}/${res.result.file_path}`
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const url = await getFileUrl(fileId)
  const res = await fetch(url)
  return Buffer.from(await res.arrayBuffer())
}

export async function notifyAdmins(text: string) {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data } = await supabase
    .from('telegram_users')
    .select('telegram_id, users!inner(role)')
    .eq('users.role', 'admin')
  for (const row of (data ?? [])) {
    await sendMessage((row as any).telegram_id, text).catch(() => {})
  }
}

export async function transcribeVoice(fileId: string): Promise<string> {
  const buffer = await downloadFile(fileId)
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(buffer)], { type: 'audio/ogg' }), 'voice.ogg')
  formData.append('model', 'whisper-1')
  formData.append('language', 'ru')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: formData,
  })
  const json = await res.json() as any
  return json.text ?? ''
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
