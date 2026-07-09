// Класс устройства по User-Agent: телефон/планшет = mobile, остальное = desktop.
// Лимит устройств считается по классу: 1 mobile + 1 desktop на аккаунт.

export type DeviceClass = 'mobile' | 'desktop'

export function classifyDevice(ua: string | null | undefined): DeviceClass {
  const s = (ua ?? '').toLowerCase()
  if (/iphone|ipod|windows phone/.test(s)) return 'mobile'
  if (/android/.test(s)) return 'mobile'          // и телефоны, и планшеты Android
  if (/ipad|tablet/.test(s)) return 'mobile'
  return 'desktop'
}

export const DEVICE_CLASS_LABELS: Record<DeviceClass, string> = {
  mobile: 'Телефон',
  desktop: 'Компьютер',
}
