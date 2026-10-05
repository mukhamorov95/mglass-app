import { describe, it, expect } from 'vitest'
import { parseAvitoEvent, avitoChatUrl, inquiryNotifyText } from '@/lib/b2b/avitoInquiry'

const OWN = 555
const msg = (v: Record<string, unknown>, type = 'message') => ({ payload: { type, value: { id: 'm1', chat_id: 'u2i-abc', user_id: OWN, author_id: 777, chat_type: 'u2i', created: 1759700000, item_id: 42, content: { text: '  Нужно стекло 600×800  ' }, ...v } } })

describe('parseAvitoEvent — что пришло вебхуком GLASMEN', () => {
  it('сообщение клиента — входящее, текст обрезан по краям', () => {
    const e = parseAvitoEvent(msg({}), OWN)
    expect(e).toMatchObject({ kind: 'in', chatId: 'u2i-abc', itemId: 42, text: 'Нужно стекло 600×800', msgId: 'm1' })
    if (e.kind !== 'skip') expect(e.at).toBe(new Date(1759700000 * 1000).toISOString())
  })
  it('наш ответ — исходящее', () => {
    expect(parseAvitoEvent(msg({ author_id: OWN }), OWN).kind).toBe('out')
  })
  it('чужой аккаунт отбрасывается: вебхук одного кабинета', () => {
    expect(parseAvitoEvent(msg({ user_id: 999 }), OWN)).toEqual({ kind: 'skip', reason: 'чужой аккаунт' })
  })
  it('системное сообщение (author_id 0) и не-сообщение — пропуск', () => {
    expect(parseAvitoEvent(msg({ author_id: 0 }), OWN).kind).toBe('skip')
    expect(parseAvitoEvent(msg({}, 'status'), OWN).kind).toBe('skip')
    expect(parseAvitoEvent(null, OWN).kind).toBe('skip')
  })
  it('без id сообщения ключ дедупа всё равно есть', () => {
    const e = parseAvitoEvent(msg({ id: undefined }), OWN)
    expect(e.kind !== 'skip' && e.msgId.startsWith('u2i-abc|')).toBe(true)
  })
})

describe('уведомление в Telegram', () => {
  const inq = { id: 7, source: 'avito', contact_name: 'Иван <ООО>', company: null, phone: null, chat_url: avitoChatUrl('u2i-abc'), listing: 'Стекло & зеркало', request: 'a<b' }
  it('всё от клиента экранировано под parse_mode HTML', () => {
    const t = inquiryNotifyText(inq, 'new')
    expect(t).toContain('Иван &lt;ООО&gt;')
    expect(t).toContain('Стекло &amp; зеркало')
    expect(t).toContain('a&lt;b')
    expect(t).not.toMatch(/<ООО>|a<b/)
  })
  it('новая и повторная — разные заголовки', () => {
    expect(inquiryNotifyText(inq, 'new')).toContain('Новая заявка')
    expect(inquiryNotifyText(inq, 'again')).toContain('написал снова')
  })
  it('ссылка на чат Авито', () => {
    expect(avitoChatUrl('u2i-abc')).toBe('https://www.avito.ru/profile/messenger/channel/u2i-abc')
  })
})
