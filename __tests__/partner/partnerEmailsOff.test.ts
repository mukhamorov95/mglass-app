import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { notifyPartnerOrderStatus, notifyPartnerAccessGranted } from '@/lib/notify'

// Решение владельца 01.10.2026: партнёрам ничего не рассылаем, пока он сам не включит.
describe('письма партнёрам выключены по умолчанию', () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('PARTNER_EMAILS', '')
    fetchMock.mockClear()
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it('статус заказа — не уходит, даже когда ключ почты есть', async () => {
    expect(await notifyPartnerOrderStatus({ to: 'p@example.com', clientName: 'П', orderNumber: '1', kind: 'shipped', link: 'x' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('ссылка на пароль — тоже не уходит (владелец копирует её с экрана)', async () => {
    expect(await notifyPartnerAccessGranted({ to: 'p@example.com', clientName: 'П', setupLink: 'x' })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('включается только явным PARTNER_EMAILS=on', async () => {
    vi.stubEnv('PARTNER_EMAILS', 'on')
    expect(await notifyPartnerOrderStatus({ to: 'p@example.com', clientName: 'П', orderNumber: '1', kind: 'shipped', link: 'x' })).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
