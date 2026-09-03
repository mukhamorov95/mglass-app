'use client'

import { Suspense } from 'react'
import { B2BCalculatorPage } from '../b2b/page'

// Вкладка «Расчёт B2B» в контуре M-Glass. Тот же B2B-калькулятор, но в mglass-режиме:
// клиент зафиксирован на M GLASS, срок производства скрыт, справа панель быстрого расчёта.
export default function Page() {
  return <Suspense fallback={null}><B2BCalculatorPage variant="mglass" /></Suspense>
}
