'use client'

import dynamic from 'next/dynamic'
import type { MModel } from '@/lib/configurator/arrangement'
import type { MDims, GlassTint, HardwareChoice, MVariant } from './scene/assembly'
import type { PickedNode } from './Partition3D'

export type { PickedNode }

// Canvas (WebGL) нельзя рендерить на сервере — грузим только на клиенте.
const Partition3D = dynamic(() => import('./Partition3D'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[420px] md:h-[480px] rounded-xl bg-[#eeece8] grid place-items-center text-[13px] text-[#9a9a95]">
      Загрузка 3D…
    </div>
  ),
})

export function Partition3DView(props: {
  model: MModel; dims: MDims; thickness: number; finishHex: string; finishId: string; glassTint: GlassTint; doorOpen?: boolean; choice?: HardwareChoice; variant?: MVariant
  onPick?: (n: PickedNode) => void; pickedKey?: string | null; pickedRole?: string | null
}) {
  return <Partition3D {...props} />
}
