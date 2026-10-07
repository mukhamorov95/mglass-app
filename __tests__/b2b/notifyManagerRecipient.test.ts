import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase-service', () => ({ createServiceClient: () => ({}) }))
vi.mock('@/lib/telegram', () => ({ sendMessage: vi.fn() }))

import { managerRecipient } from '@/lib/b2b/notifyManager'

describe('сообщение «менеджеру заказа» — только сотруднику', () => {
  it('автор-сотрудник получает', () => {
    expect(managerRecipient({ created_by: 'u1' }, 'manager')).toBe('u1')
    expect(managerRecipient({ created_by: 'u1', source: 'internal' }, 'admin')).toBe('u1')
  })
  it('заказ из кабинета партнёра или автор-партнёр — никому', () => {
    expect(managerRecipient({ created_by: 'p1', source: 'partner' }, 'manager')).toBeNull()
    expect(managerRecipient({ created_by: 'p1' }, 'partner')).toBeNull()
  })
  it('роль неизвестна или автора нет — никому', () => {
    expect(managerRecipient({ created_by: 'u1' }, null)).toBeNull()
    expect(managerRecipient({ created_by: null }, 'manager')).toBeNull()
    expect(managerRecipient(null, 'manager')).toBeNull()
  })
})
