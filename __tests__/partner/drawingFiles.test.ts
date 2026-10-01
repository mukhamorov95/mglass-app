import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkDrawingFile, sniffMime, storagePath, photoScale, MAX_FILE_BYTES, MAX_FILES_PER_ORDER } from '@/lib/partner/drawingFiles'

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50])
const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0])

describe('тип файла — по первым байтам', () => {
  it('PDF, JPEG, PNG, WebP узнаются', () => {
    expect(sniffMime(PDF)).toBe('application/pdf')
    expect(sniffMime(JPG)).toBe('image/jpeg')
    expect(sniffMime(PNG)).toBe('image/png')
    expect(sniffMime(WEBP)).toBe('image/webp')
  })
  it('HEIC и исполняемый файл — нет, даже с «правильным» именем', () => {
    expect(sniffMime(HEIC)).toBeNull()
    expect(sniffMime(EXE)).toBeNull()
  })
})

describe('checkDrawingFile', () => {
  it('нормальный PDF проходит', () => expect(checkDrawingFile(PDF, 1000, 0)).toEqual({ ok: true, mime: 'application/pdf' }))
  it('больше 4 МБ, пустой, лишний по счёту — понятный отказ', () => {
    expect(checkDrawingFile(PDF, MAX_FILE_BYTES + 1, 0)).toMatchObject({ ok: false, error: expect.stringContaining('4 МБ') })
    expect(checkDrawingFile(PDF, 0, 0)).toMatchObject({ ok: false })
    expect(checkDrawingFile(PDF, 1000, MAX_FILES_PER_ORDER)).toMatchObject({ ok: false, error: expect.stringContaining(String(MAX_FILES_PER_ORDER)) })
  })
  it('HEIC — с подсказкой, что делать', () => {
    expect(checkDrawingFile(HEIC, 1000, 0)).toMatchObject({ ok: false, error: expect.stringContaining('HEIC') })
  })
})

describe('storagePath и photoScale', () => {
  it('путь без кириллицы и чужих расширений, внутри папки партнёра', () => {
    const p = storagePath(71, 1234, '../Чертёж душевой.exe', 'application/pdf', 1)
    expect(p.startsWith('partner/71/1234/1_')).toBe(true)
    expect(p.endsWith('.pdf')).toBe(true)
    expect(p).not.toMatch(/[^a-zA-Z0-9_./-]/)
    expect(p.split('/')).toHaveLength(4)
  })
  it('фото 4032×3024 ужимается до ≈2 Мпикс, маленькое не трогаем', () => {
    const k = photoScale(4032, 3024)
    expect(Math.round(4032 * k) * Math.round(3024 * k)).toBeLessThanOrEqual(2_001_000)
    expect(photoScale(1200, 900)).toBe(1)
  })
})

// ── маршрут /api/partner/quote/[id]/files ─────────────────────────────────────

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))

const h = vi.hoisted(() => ({
  user: { id: 'u-partner' } as { id: string } | null,
  order: null as Record<string, unknown> | null,
  files: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  uploaded: [] as string[],
  removed: [] as string[],
}))

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: null }) } }),
}))

vi.mock('@/lib/supabase-service', () => ({
  createServiceClient: () => ({
    storage: {
      from: () => ({
        upload: async (path: string) => { h.uploaded.push(path); return { error: null } },
        remove: async (paths: string[]) => { h.removed.push(...paths); return { error: null } },
      }),
    },
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let insertRow: Record<string, unknown> | null = null
      let del = false
      const rows = () => {
        if (table === 'b2b_clients') return [{ id: 71, user_id: 'u-partner' }]
        if (table === 'b2b_client_members') return []
        if (table === 'b2b_orders') return h.order ? [h.order] : []
        if (table === 'b2b_calculation_attachments') return h.files
        return []
      }
      const match = () => rows().filter(r => Object.entries(filters).every(([k, v]) => r[k] === v))
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (k: string, v: unknown) => { filters[k] = v; return chain },
        order: () => chain,
        insert: (row: Record<string, unknown>) => { insertRow = { id: '00000000-0000-0000-0000-00000000000a', created_at: 'now', ...row }; h.inserted.push(insertRow); return chain },
        delete: () => { del = true; return chain },
        maybeSingle: async () => ({ data: match()[0] ?? null, error: null }),
        single: async () => ({ data: insertRow, error: null }),
        then: (res: (v: unknown) => void) => {
          if (del) { const m = match(); h.files = h.files.filter(f => !m.includes(f)); return res({ data: m.map(x => ({ id: x.id })), error: null }) }
          return res({ data: match(), error: null })
        },
      }
      return chain
    },
  }),
}))

import { GET, POST, DELETE } from '@/app/api/partner/quote/[id]/files/route'

const ctx = (id = '500') => ({ params: Promise.resolve({ id }) })
function upload(bytes: Uint8Array, kind = 'drawing', name = 'chertezh.pdf') {
  const fd = new FormData()
  fd.append('file', new File([bytes as BlobPart], name))
  fd.append('kind', kind)
  return POST(new Request('http://x/api/partner/quote/500/files', { method: 'POST', body: fd }), ctx())
}

beforeEach(() => {
  h.user = { id: 'u-partner' }
  h.order = { id: 500, client_id: 71, launched_at: null, notes: null }
  h.files = []
  h.inserted = []
  h.uploaded = []
  h.removed = []
})

describe('загрузка файла партнёром', () => {
  it('свой просчёт: файл уходит в папку партнёра, строка с видом и автором', async () => {
    const r = await upload(PDF)
    expect(r.status).toBe(200)
    expect(h.uploaded[0]).toMatch(/^partner\/71\/500\/\d+_chertezh\.pdf$/)
    expect(h.inserted[0]).toMatchObject({ order_id: 500, kind: 'drawing', file_type: 'application/pdf', uploaded_by: 'partner:u-partner' })
  })

  it('чужой просчёт — 404, ничего не записано', async () => {
    h.order = { id: 500, client_id: 99, launched_at: null, notes: null }
    expect((await upload(PDF)).status).toBe(404)
    expect(h.uploaded).toEqual([])
  })

  it('заказ уже в работе — 400', async () => {
    h.order = { id: 500, client_id: 71, launched_at: '2026-10-01', notes: null }
    expect((await upload(PDF)).status).toBe(400)
  })

  it('не тот формат или не указан вид — 400', async () => {
    expect((await upload(EXE, 'drawing', 'chertezh.pdf')).status).toBe(400)
    expect((await upload(PDF, 'photo')).status).toBe(400)
    expect(h.uploaded).toEqual([])
  })

  it('без входа — 401', async () => {
    h.user = null
    expect((await GET(new Request('http://x'), ctx())).status).toBe(401)
  })
})

describe('удаление', () => {
  it('свой файл до запуска — удаляется из базы и хранилища', async () => {
    h.files = [{ id: '11111111-1111-1111-1111-111111111111', order_id: 500, file_url: 'partner/71/500/a.pdf', uploaded_by: 'partner:u-partner' }]
    const r = await DELETE(new Request('http://x?file=11111111-1111-1111-1111-111111111111', { method: 'DELETE' }), ctx())
    expect(r.status).toBe(200)
    expect(h.removed).toEqual(['partner/71/500/a.pdf'])
  })

  it('файл менеджера партнёр не удаляет', async () => {
    h.files = [{ id: '22222222-2222-2222-2222-222222222222', order_id: 500, file_url: '500/m.pdf', uploaded_by: null }]
    const r = await DELETE(new Request('http://x?file=22222222-2222-2222-2222-222222222222', { method: 'DELETE' }), ctx())
    expect(r.status).toBe(403)
    expect(h.removed).toEqual([])
  })
})
