const API = 'https://api.wazzup24.com/v3'
const KEY = process.env.WAZZUP_API_KEY!

function headers() {
  return { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' }
}

export async function sendMessage(channelId: string, chatId: string, chatType: string, text: string) {
  const res = await fetch(`${API}/message`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ channelId, chatId, chatType, text }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Wazzup send error ${res.status}: ${err}`)
  }
  return res.json()
}

export async function setWebhook(url: string) {
  const res = await fetch(`${API}/webhooks`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ webhooksUri: url, subscriptions: ['messages'] }),
  })
  return res.json()
}

export async function getChannels() {
  const res = await fetch(`${API}/channels`, { headers: headers() })
  return res.json()
}
