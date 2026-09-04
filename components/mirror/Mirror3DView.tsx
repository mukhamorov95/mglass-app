'use client'

import dynamic from 'next/dynamic'
import type { Mirror3DProps } from './Mirror3D'

// Canvas (WebGL) на сервере не рендерится — грузим только в браузере,
// тем же приёмом, что и сцена душевых.
const Mirror3D = dynamic(() => import('./Mirror3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full rounded-xl bg-[#eeece8] grid place-items-center text-[13px] text-[#9a9a95]">
      Загрузка 3D…
    </div>
  ),
})

export function Mirror3DView(props: Mirror3DProps) {
  return <Mirror3D {...props} />
}
