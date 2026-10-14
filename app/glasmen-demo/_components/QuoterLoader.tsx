'use client'

import dynamic from 'next/dynamic'
import type { Tab } from './quoterState'

// Расчёт живёт в браузере (разбор DXF, черновик в localStorage) — без серверного рендера,
// чтобы черновик читался сразу при создании состояния, а не эффектом после гидрации.
const Quoter = dynamic(() => import('./Quoter'), {
  ssr: false,
  loading: () => <div className="h-96 animate-pulse rounded-2xl border border-[#e4e4e0] bg-white" aria-label="Загружаю калькулятор" />,
})

export default function QuoterLoader({ initialTab }: { initialTab: Tab | null }) {
  return <Quoter initialTab={initialTab} />
}
