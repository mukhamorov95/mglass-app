'use client'

import type { AmoLeadState } from '@/lib/useAmoLead'

// Плашка над калькулятором: по какой сделке AmoCRM считаем и куда ляжет расчёт.
export function AmoLeadBanner({ state }: { state: AmoLeadState }) {
  if (state.requested == null) return null
  if (state.error) return (
    <p className="mb-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
      Сделка AmoCRM №{state.requested} не подтянулась: {state.error}. Расчёт сохранится без привязки к ней — клиента впишите вручную.
    </p>
  )
  if (!state.lead) return (
    <p className="mb-3 text-[12px] text-[#6b6b66] bg-white border border-[#e4e4e0] rounded-xl px-3 py-2">
      Загружаю сделку AmoCRM №{state.requested}…
    </p>
  )
  const l = state.lead
  return (
    <p className="mb-3 text-[12px] text-[#4b4b47] bg-[#eef3ee] border border-[#cfe0d3] rounded-xl px-3 py-2">
      Расчёт по сделке AmoCRM{' '}
      <a href={l.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-[#cfe0d3] hover:decoration-[#4b4b47]">№{l.id} · {l.name}</a>
      {l.stageName ? ` · ${l.stageName}` : ''}{l.closed ? ' · сделка закрыта' : ''}.
      {' '}После сохранения расчёт и КП появятся в строке этой сделки на странице «Сделки в AmoCRM».
    </p>
  )
}
