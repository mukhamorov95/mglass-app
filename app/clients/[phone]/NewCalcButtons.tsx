'use client'

import { useRouter } from 'next/navigation'

// М2: новый расчёт прямо из карточки сделки. Смысл не в кнопке, а в том, что
// расчёт уносит с собой имя и телефон клиента: сейчас только у 7 расчётов из 91
// заполнен телефон, поэтому расчёты не привязываются ни к заявке, ни к сделке.
// Префилл кладём в sessionStorage — тем же механизмом, каким работает «Пересчитать».

const TARGETS = [
  { key: 'mirror', label: '🪞 Зеркало', href: '/calculator/mirror', store: 'mglass_mirror_prefill' },
  { key: 'shower', label: '🚿 Душевая', href: '/calculator/shower', store: 'mglass_shower_prefill' },
  { key: 'quick',  label: '⚡ Быстрый расчёт', href: '/calculator/quick', store: null },
] as const

export default function NewCalcButtons({ clientName, clientPhone }: { clientName: string; clientPhone: string | null }) {
  const router = useRouter()

  function go(t: (typeof TARGETS)[number]) {
    if (t.store) {
      try {
        sessionStorage.setItem(t.store, JSON.stringify({ clientName, clientPhone: clientPhone ?? '' }))
      } catch { /* приватный режим — просто откроем пустой калькулятор */ }
    }
    router.push(t.href)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {TARGETS.map(t => (
        <button key={t.key} onClick={() => go(t)}
          className="text-[12px] font-medium px-3 py-1.5 rounded-xl border border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] transition-colors">
          {t.label}
        </button>
      ))}
    </div>
  )
}
