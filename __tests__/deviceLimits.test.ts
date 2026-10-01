import { describe, it, expect } from 'vitest'
import { deviceLimitFor, isDeviceAllowed, deviceLabel } from '@/lib/deviceLimits'

describe('лимит устройств (У10)', () => {
  it('компьютеров два, телефон и планшет по одному', () => {
    expect(deviceLimitFor('desktop')).toBe(2)
    expect(deviceLimitFor('mobile')).toBe(1)
    expect(deviceLimitFor('tablet')).toBe(1)
  })

  it('своё устройство проходит, даже когда места кончились', () => {
    expect(isDeviceAllowed(['a', 'b'], 'a', 'desktop')).toBe(true)
  })

  it('второй компьютер проходит, третий — нет', () => {
    expect(isDeviceAllowed(['a'], 'b', 'desktop')).toBe(true)
    expect(isDeviceAllowed(['a', 'b'], 'c', 'desktop')).toBe(false)
  })

  it('второй телефон не проходит', () => {
    expect(isDeviceAllowed(['a'], 'b', 'mobile')).toBe(false)
  })

  it('пустой список — первое устройство всегда проходит', () => {
    expect(isDeviceAllowed([], 'a', 'mobile')).toBe(true)
  })

  it('подпись устройства узнаваема человеком', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0 YaBrowser/26.8.0.0 Safari/537.36'))
      .toBe('Яндекс.Браузер · Windows')
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) Version/26.6 Mobile/15E148 Safari/604.1'))
      .toBe('Safari · iOS')
  })
})
