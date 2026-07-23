import { describe, it, expect, vi, afterEach } from 'vitest'
import { transcribeRu } from '@/lib/transcribe'

const OLD = { o: process.env.OPENAI_API_KEY, g: process.env.GROQ_API_KEY }
const blob = new Blob(['x'], { type: 'audio/webm' })
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response

afterEach(() => {
  process.env.OPENAI_API_KEY = OLD.o
  process.env.GROQ_API_KEY = OLD.g
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('transcribeRu — расшифровка с фолбэком', () => {
  it('нет ключей → no_key', async () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GROQ_API_KEY
    const r = await transcribeRu(blob, 'n.webm')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('no_key')
  })

  it('OpenAI ок → текст, provider openai (обрезает пробелы)', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    delete process.env.GROQ_API_KEY
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { text: '  привет  ' })))
    const r = await transcribeRu(blob, 'n.webm')
    expect(r).toEqual({ ok: true, text: 'привет', provider: 'openai' })
  })

  it('OpenAI 429 без Groq → quota (429)', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    delete process.env.GROQ_API_KEY
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})))
    const r = await transcribeRu(blob, 'n.webm')
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBe('quota'); expect(r.status).toBe(429) }
  })

  it('OpenAI 429 → падает на Groq и распознаёт', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    process.env.GROQ_API_KEY = 'gsk-y'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(429, {}))
      .mockResolvedValueOnce(res(200, { text: 'через groq' }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await transcribeRu(blob, 'n.webm')
    expect(r).toEqual({ ok: true, text: 'через groq', provider: 'groq' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('OpenAI 200 но пустой текст → empty (без фолбэка)', async () => {
    process.env.OPENAI_API_KEY = 'sk-x'
    delete process.env.GROQ_API_KEY
    vi.stubGlobal('fetch', vi.fn(async () => res(200, { text: '   ' })))
    const r = await transcribeRu(blob, 'n.webm')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('empty')
  })

  it('только Groq-ключ → Groq как основной', async () => {
    delete process.env.OPENAI_API_KEY
    process.env.GROQ_API_KEY = 'gsk-y'
    const fetchMock = vi.fn(async () => res(200, { text: 'groq only' }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await transcribeRu(blob, 'n.webm')
    expect(r).toEqual({ ok: true, text: 'groq only', provider: 'groq' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
