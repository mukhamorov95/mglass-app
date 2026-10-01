import type { DeviceClass } from './deviceClass'

// Сколько устройств одного класса работает одновременно. Решение владельца 01.10:
// два компьютера. Замер 29.09–01.10 показал, что на /device-limit попадают не
// посторонние, а свои: Яна 11 раз, Александра 13 раз за один день — второй браузер
// или вкладка без куки вытесняли их же рабочий вход.
export const DEVICE_LIMIT: Record<DeviceClass, number> = {
  desktop: 2,
  mobile: 1,
  tablet: 1,
}

export function deviceLimitFor(cls: DeviceClass): number {
  return DEVICE_LIMIT[cls] ?? 1
}

// Пускать ли это устройство: своё — всегда (иначе человек выбивает сам себя при
// каждом переходе), чужое — пока в классе есть свободное место.
export function isDeviceAllowed(activeDeviceIds: string[], deviceId: string, cls: DeviceClass): boolean {
  if (activeDeviceIds.includes(deviceId)) return true
  return activeDeviceIds.length < deviceLimitFor(cls)
}

// Короткая подпись устройства для экрана: «Chrome · Windows». Нужна, чтобы человек
// узнал свой второй компьютер и понял, какое устройство держит место.
export function deviceLabel(ua: string | null | undefined): string {
  const s = ua ?? ''
  const browser =
    /YaBrowser/i.test(s) ? 'Яндекс.Браузер' :
    /Edg\//i.test(s) ? 'Edge' :
    /OPR\//i.test(s) ? 'Opera' :
    /Firefox/i.test(s) ? 'Firefox' :
    /Chrome/i.test(s) ? 'Chrome' :
    /Safari/i.test(s) ? 'Safari' : 'браузер'
  const os =
    /Windows/i.test(s) ? 'Windows' :
    /iPhone|iPad|iPod/i.test(s) ? 'iOS' :
    /Mac OS X/i.test(s) ? 'macOS' :
    /Android/i.test(s) ? 'Android' :
    /Linux/i.test(s) ? 'Linux' : ''
  return os ? `${browser} · ${os}` : browser
}
