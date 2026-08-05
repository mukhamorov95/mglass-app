'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { PartitionDrawing } from '@/components/configurator/PartitionDrawing'
import {
  PARTITION_TYPES, FINISHES, HINGES, computeConfiguration,
  type PartitionTypeId, type FinishId, type Dims,
} from '@/lib/configurator/catalog'

const GLASS_PRICE: Record<number, number> = { 8: 4200, 10: 5200 } // ₽/м², ориентировочно

// Каталожные карточки (рендеры из «Комплектации перегородок»)
const RENDER: Partial<Record<PartitionTypeId, string>> = {
  'corner-swing':      '/configurator/renders/corner-swing.jpg',
  'straight-swing':    '/configurator/renders/straight-swing.jpg',
  'trapezoid':         '/configurator/renders/trapezoid.jpg',
  'corner-sliding':    '/configurator/renders/corner-sliding.jpg',
  'straight-sliding':  '/configurator/renders/straight-sliding.jpg',
  'bath-screen':       '/configurator/renders/bath-screen.jpg',
  'bath-screen-swing': '/configurator/renders/bath-screen-swing.jpg',
  'stationary':        '/configurator/renders/stationary.jpg',
}

function mid([a, b]: [number, number]) { return Math.round((a + b) / 200) * 100 }

function defaultsFor(id: PartitionTypeId): Dims {
  const t = PARTITION_TYPES.find(t => t.id === id)!
  return {
    width: mid(t.constraints.width),
    height: Math.min(2000, t.constraints.height[1]),
    width2: t.constraints.needsWidth2 && t.constraints.width2 ? mid(t.constraints.width2) : undefined,
    doorWidth: t.constraints.doorWidth ? 600 : undefined,
  }
}

function Field({ label, value, min, max, step = 10, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <label className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">{label}</label>
        <span className="text-[12px] font-mono text-[#111110]">{value} мм</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-[#111110]" />
    </div>
  )
}

export default function ConfiguratorPage() {
  const [typeId, setTypeId] = useState<PartitionTypeId>('corner-swing')
  const [dims, setDims] = useState<Dims>(() => defaultsFor('corner-swing'))
  const [thickness, setThickness] = useState(8)
  const [finishId, setFinishId] = useState<FinishId>('chrome')
  const [hingeCode, setHingeCode] = useState('Balge-004')
  const [hwCost, setHwCost] = useState<Record<string, number>>({})

  useEffect(() => {
    createClient()
      .from('shower_standard_hardware').select('name, cost_price').eq('active', true)
      .then(({ data }) => {
        const map: Record<string, number> = {}
        for (const r of (data ?? []) as { name: string; cost_price: number }[]) map[r.name] = Number(r.cost_price) || 0
        setHwCost(map)
      })
  }, [])

  const type = PARTITION_TYPES.find(t => t.id === typeId)!
  function changeType(id: PartitionTypeId) {
    setTypeId(id)
    setDims(defaultsFor(id))
    const nt = PARTITION_TYPES.find(t => t.id === id)!
    if (!nt.thickness.includes(thickness)) setThickness(nt.thickness[0])
  }
  function setD<K extends keyof Dims>(k: K, v: Dims[K]) { setDims(d => ({ ...d, [k]: v })) }

  const config = useMemo(
    () => computeConfiguration(typeId, dims, thickness, finishId, hingeCode),
    [typeId, dims, thickness, finishId, hingeCode],
  )

  const lines = config.bom.map(b => {
    const unit = Object.entries(hwCost).find(([name]) => name.startsWith(b.code))?.[1] ?? 0
    return { ...b, unit_cost: unit, total: Math.round(unit * b.qty) }
  })
  const hardwareTotal = lines.reduce((s, l) => s + l.total, 0)
  const glassCost = Math.round(config.glassAreaM2 * (GLASS_PRICE[thickness] ?? 0))
  const materialsTotal = glassCost + hardwareTotal

  function copySpec() {
    const txt = [
      `${type.label} — ${dims.width}${type.constraints.needsWidth2 ? `×${dims.width2}` : ''}×${dims.height} мм`,
      `Стекло закалённое ${thickness} мм · ${config.glassAreaM2} м²`,
      `Фурнитура (${config.finish.label}):`,
      ...config.bom.map(b => `  — ${b.code}: ${b.qty} ${b.unit}`),
    ].join('\n')
    navigator.clipboard?.writeText(txt)
  }

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8">
      <div className="mb-6">
        <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Конфигуратор перегородок</h1>
        <p className="text-[13px] text-[#8a8a85] mt-0.5">Тип → размеры → стекло → финиш. Чертёж и спецификация — вживую.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-6">
        {/* Управление */}
        <div className="space-y-5">
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Тип перегородки</label>
            <div className="grid gap-1.5">
              {PARTITION_TYPES.map(t => (
                <button key={t.id} onClick={() => changeType(t.id)}
                  className={`text-left px-3 py-2 rounded-lg text-[13px] border transition-colors ${
                    typeId === t.id ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'
                  }`}>
                  {t.label}
                  <span className={`block text-[11px] ${typeId === t.id ? 'text-white/60' : 'text-[#9a9a95]'}`}>{t.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3.5 bg-white border border-[#e4e4e0] rounded-xl p-4">
            <Field label="Ширина" value={dims.width} min={type.constraints.width[0]} max={type.constraints.width[1]} onChange={v => setD('width', v)} />
            {type.constraints.needsWidth2 && type.constraints.width2 && (
              <Field label="Ширина 2" value={dims.width2 ?? 0} min={type.constraints.width2[0]} max={type.constraints.width2[1]} onChange={v => setD('width2', v)} />
            )}
            <Field label="Высота" value={dims.height} min={type.constraints.height[0]} max={type.constraints.height[1]} onChange={v => setD('height', v)} />
            {type.constraints.doorWidth && (
              <Field label="Дверь" value={dims.doorWidth ?? 600} min={type.constraints.doorWidth[0]} max={type.constraints.doorWidth[1]} onChange={v => setD('doorWidth', v)} />
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Стекло, мм</label>
            <div className="flex gap-1.5">
              {type.thickness.map(t => (
                <button key={t} onClick={() => setThickness(t)}
                  className={`px-4 py-1.5 rounded-lg text-[13px] border ${thickness === t ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Финиш фурнитуры</label>
            <div className="grid grid-cols-5 gap-1.5">
              {FINISHES.map(f => (
                <button key={f.id} onClick={() => setFinishId(f.id)} title={f.label}
                  className={`h-9 rounded-lg border-2 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`}
                  style={{ background: f.hex }} />
              ))}
            </div>
            <p className="text-[12px] text-[#6b6b66] mt-1.5">{config.finish.label}</p>
          </div>

          {type.constraints.doorWidth && (
            <div>
              <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Петля</label>
              <div className="grid gap-1.5">
                {HINGES.filter(h => h.mount === 'glass').map(h => (
                  <button key={h.code} onClick={() => setHingeCode(h.code)}
                    className={`text-left px-3 py-2 rounded-lg text-[13px] border transition-colors ${
                      hingeCode === h.code ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'
                    }`}>
                    <div className="flex justify-between">
                      <span>{h.code}{h.premium ? ' · премиум' : ''}</span>
                      <span className="font-mono text-[12px]">от {h.priceFrom.toLocaleString('ru-RU')} ₽</span>
                    </div>
                    <span className={`block text-[11px] ${hingeCode === h.code ? 'text-white/60' : 'text-[#9a9a95]'}`}>Угол {h.angle}</span>
                  </button>
                ))}
              </div>
              {config.hinge?.cutout && (
                <p className="text-[11px] text-[#9a9a95] mt-1.5">Вырез в стекле: {config.hinge.cutout}</p>
              )}
            </div>
          )}
        </div>

        {/* Визуал: каталожный рендер + живой чертёж */}
        <div className="min-w-0 space-y-4">
          {RENDER[typeId] && (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={RENDER[typeId]} alt={type.label} className="w-full rounded-lg" />
              <p className="text-[11px] text-[#9a9a95] mt-2 text-center">Каталог M-Glass · {type.label}</p>
            </div>
          )}
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-4 flex items-center justify-center">
            <PartitionDrawing config={config} />
          </div>
          {config.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {config.warnings.map((w, i) => (
                <p key={i} className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">⚠ {w}</p>
              ))}
            </div>
          )}
        </div>

        {/* Спецификация */}
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-3">Спецификация</p>
            <div className="text-[13px] flex justify-between py-1.5 border-b border-[#f0f0ec]">
              <span className="text-[#4b4b47]">Стекло {thickness} мм · {config.glassAreaM2} м²</span>
              <span className="font-mono text-[#111110]">{glassCost.toLocaleString('ru-RU')} ₽</span>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="text-[13px] flex justify-between py-1.5 border-b border-[#f8f8f7] last:border-0">
                <span className="text-[#4b4b47]">{l.code} <span className="text-[#9a9a95]">· {l.qty} {l.unit}</span></span>
                <span className="font-mono text-[#111110]">{l.total > 0 ? `${l.total.toLocaleString('ru-RU')} ₽` : '—'}</span>
              </div>
            ))}
          </div>

          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex justify-between items-baseline">
              <span className="text-[13px] text-[#6b6b66]">Материалы, ориентировочно</span>
              <span className="text-[17px] font-semibold text-[#111110] font-mono">{materialsTotal.toLocaleString('ru-RU')} ₽</span>
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-1">Без монтажа и наценки. Цена фурнитуры — из /admin/shower-hardware.</p>
          </div>

          <button onClick={copySpec}
            className="w-full bg-[#111110] text-white text-[13px] font-medium py-2.5 rounded-lg hover:bg-[#2a2a28]">
            Скопировать спецификацию
          </button>
        </div>
      </div>
    </div>
  )
}
