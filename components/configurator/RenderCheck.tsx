'use client'

import { useCallback, useRef, useState } from 'react'
import { Partition3DView, type CaptureFn } from '@/components/configurator/Partition3DView'
import { getModel } from '@/lib/configurator/arrangement'
import { FINISHES } from '@/lib/configurator/catalog'
import type { MDims } from '@/components/configurator/scene/assembly'

// R8 · Сверка. Спор о красоте не сходится словами, поэтому эталон и живая сцена
// стоят рядом в одинаковой конфигурации. Модель зафиксирована: М1 со стабилизатором —
// ровно то, что на эталоне владельца. Габариты и стекло тоже фиксированы: сверка
// имеет смысл, только если сравнивают одно и то же.
const CHECK_DIMS: MDims = { width: 1100, height: 2000, trayDepth: 1000 }
const REFERENCE = '/configurator/reference/target.jpg'

const CRITERIA = [
  ['Кадр', 'Изделие держит кадр, камера на уровне глаз, угол комнаты виден'],
  ['Стекло', 'Почти невидимое; зелёный только по кромке, не по плоскости'],
  ['Плитка', 'Крупный формат, тонкий шов, фактура на грани заметности'],
  ['Пол', 'Отражение кабины читается, но не спорит с изделием'],
  ['Свет', 'Мягкий, слева сверху; стены не в пересвете, угол не в чёрном'],
  ['Поддон', 'Бортик и утопленное поле различимы, кромки скруглены'],
]

export function RenderCheck() {
  const captureApi = useRef<CaptureFn | null>(null)
  const holdCapture = useCallback((fn: CaptureFn | null) => { captureApi.current = fn }, [])
  const [shooting, setShooting] = useState(false)
  const [refMissing, setRefMissing] = useState(false)
  const model = getModel('М1')
  const finish = FINISHES.find(f => f.id === 'black') ?? FINISHES[0]

  async function shoot() {
    if (!captureApi.current || shooting) return
    setShooting(true)
    try {
      const url = await captureApi.current(1)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mglass-render-check.png'
      a.click()
    } finally { setShooting(false) }
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] text-[#111110] p-6">
      <div className="max-w-[1500px] mx-auto space-y-4">
        <div>
          <h1 className="text-[22px] font-semibold">Сверка рендера</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5">
            Эталон и живая сцена в одной конфигурации: М1 со стабилизатором, 1100×2000, поддон 1000, фурнитура чёрная.
            Маршрут — <span className="font-mono text-[12px]">docs/configurator/RENDER_ROUTE.md</span>
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-3">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Эталон</p>
            {refMissing ? (
              <div className="h-[420px] md:h-[480px] rounded-xl bg-[#faf8f4] border border-dashed border-[#e4e4e0] grid place-items-center px-8 text-center">
                <div className="text-[13px] text-[#9a5a2a] space-y-1">
                  <p className="font-semibold">Эталона нет в репозитории</p>
                  <p className="text-[#4b4b47]">
                    Положите картинку в <span className="font-mono text-[12px]">public/configurator/reference/target.jpg</span> —
                    без неё сверять не с чем, и маршрут снова превращается в спор о вкусе.
                  </p>
                </div>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={REFERENCE} alt="Эталон" onError={() => setRefMissing(true)}
                className="w-full h-[420px] md:h-[480px] object-contain rounded-xl bg-[#f0efec]" />
            )}
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Наша сцена</p>
              <button onClick={shoot} disabled={shooting}
                className="text-[12px] px-2.5 py-1 rounded-lg border border-[#e4e4e0] hover:border-[#111110] disabled:text-[#9a9a95]">
                {shooting ? 'Снимаем…' : 'Снять кадр'}
              </button>
            </div>
            <Partition3DView model={model} dims={CHECK_DIMS} thickness={8}
              finishHex={finish.hex} finishId={finish.id}
              glassTint={{ color: '#ffffff', attenuation: '#b8d8c4', distance: 3.5 }}
              variant={{ mount: 'stabilizer', profileFrame: 'partial' }}
              onCapture={holdCapture} />
          </div>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">Что сверяем</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
            {CRITERIA.map(([k, v]) => (
              <div key={k} className="text-[12px]">
                <span className="font-semibold text-[#111110]">{k}. </span>
                <span className="text-[#4b4b47]">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#9a9a95] mt-3">
            Правило маршрута: любая правка сцены проверяется здесь до мержа. Кадр ×4 — тот же вид
            в высоком разрешении, его же можно класть в КП и каталог.
          </p>
        </div>
      </div>
    </div>
  )
}
