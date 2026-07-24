import { describe, it, expect } from 'vitest'
import { buildInstallationHref } from '@/components/AssignInstallationButton'

describe('buildInstallationHref — предзаполнение формы монтажа из заказа/КП', () => {
  it('собирает query из всех переданных полей', () => {
    const href = buildInstallationHref({
      orderNo: '0715-2',
      clientName: 'Иванов И.',
      phone: '89990001122',
      address: 'Москва, Тверская 1',
      orderTotal: 88553,
    })
    const q = new URLSearchParams(href.split('?')[1])
    expect(href.startsWith('/installations?')).toBe(true)
    expect(q.get('order_no')).toBe('0715-2')
    expect(q.get('client_name')).toBe('Иванов И.')
    expect(q.get('phone')).toBe('89990001122')
    expect(q.get('address')).toBe('Москва, Тверская 1')
    expect(q.get('order_total')).toBe('88553')
  })

  it('срезает ведущий # у номера заказа', () => {
    const q = new URLSearchParams(buildInstallationHref({ orderNo: '#05033' }).split('?')[1])
    expect(q.get('order_no')).toBe('05033')
  })

  it('пропускает пустые/null поля — в query их нет', () => {
    const href = buildInstallationHref({ orderNo: null, clientName: '  ', phone: undefined, orderTotal: '' })
    expect(href).toBe('/installations')
  })

  it('частичное предзаполнение (КП без телефона/адреса)', () => {
    const q = new URLSearchParams(buildInstallationHref({
      orderNo: '05033', clientName: 'ООО Ромашка', orderTotal: 120000,
    }).split('?')[1])
    expect(q.get('order_no')).toBe('05033')
    expect(q.get('client_name')).toBe('ООО Ромашка')
    expect(q.get('order_total')).toBe('120000')
    expect(q.get('phone')).toBeNull()
    expect(q.get('address')).toBeNull()
  })
})
