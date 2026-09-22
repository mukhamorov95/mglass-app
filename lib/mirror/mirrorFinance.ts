import type { MirrorLightMode } from '@/lib/mirror/mirrorQuote'

// Какая строка financial_settings задаёт маржу и налог зеркала.
// Решение владельца 22.09.2026: 40% для всех зеркал — и с подсветкой, и без.
// Строка mirror_light (50%) в расчёт зеркал не идёт; её правит или убирает
// владелец в /admin/settings. Так же считает ИИ-менеджер (lib/quickCalc.ts).
export function mirrorFinanceProductType(lightMode: MirrorLightMode): 'mirror' {
  void lightMode
  return 'mirror'
}
