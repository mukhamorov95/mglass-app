import { describe, it, expect } from 'vitest'
import { webhookGate } from '@/lib/avito/webhookGate'

describe('webhookGate', () => {
  it('без секрета закрыт — даже без ключа и с пустым ключом', () => {
    expect(webhookGate(undefined, null)).toEqual({ status: 503, error: 'not configured' })
    expect(webhookGate('', null)).toEqual({ status: 503, error: 'not configured' })
    expect(webhookGate('', '')).toEqual({ status: 503, error: 'not configured' })
  })

  it('ключ не совпал или не передан — 403', () => {
    expect(webhookGate('s3cret', null)).toEqual({ status: 403, error: 'forbidden' })
    expect(webhookGate('s3cret', '')).toEqual({ status: 403, error: 'forbidden' })
    expect(webhookGate('s3cret', 'S3CRET')).toEqual({ status: 403, error: 'forbidden' })
  })

  it('ключ совпал — пропускает', () => {
    expect(webhookGate('s3cret', 's3cret')).toBeNull()
  })
})
