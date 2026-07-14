// Класс устройства по User-Agent: телефон / планшет / компьютер.
// Лимит устройств считается по классу: 1 mobile + 1 tablet + 1 desktop на аккаунт.
// Планшет отделён от телефона (14.07): мастера цеха ходят с обоими, и в одном
// классе новый вход с телефона вытеснял планшет (и наоборот) — цикл разлогинов.

export type DeviceClass = 'mobile' | 'tablet' | 'desktop'

export function classifyDevice(ua: string | null | undefined): DeviceClass {
  const s = (ua ?? '').toLowerCase()
  if (/ipad|tablet/.test(s)) return 'tablet'
  if (/android(?!.*mobile)/.test(s)) return 'tablet' // Android без «Mobile» = планшет
  if (/iphone|ipod|windows phone|android/.test(s)) return 'mobile'
  return 'desktop'
}

export const DEVICE_CLASS_LABELS: Record<DeviceClass, string> = {
  mobile: 'Телефон',
  tablet: 'Планшет',
  desktop: 'Компьютер',
}
