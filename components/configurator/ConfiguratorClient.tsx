'use client'

import { useMemo, useState } from 'react'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { M_MODELS, getModel, doorAttachment, type MModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type MDims } from '@/components/configurator/scene/assembly'

const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100

function defaultsFor(m: MModel): MDims {
  return {
    width: mid(m.constraints.width),
    height: Math.min(2000, m.constraints.height[1]),
    width2: m.constraints.needsWidth2 && m.constraints.width2 ? mid(m.constraints.width2) : undefined,
    doorWidth: m.constraints.doorWidth ? 600 : undefined,
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
        onChange={e => onChange(Number(e.target.value))} className="w-full accent-[#111110]" />
    </div>
  )
}

// Клиентский конфигуратор на 9 моделях М1–М12 (раскладка — lib/configurator/arrangement).
// variant='embed' — публичный виджет для сайта: без себестоимости, заявка через postMessage.
export function ConfiguratorClient({ variant = 'internal' }: { variant?: 'internal' | 'embed' }) {
  const embed = variant === 'embed'
  const [code, setCode] = useState<string>('М7')
  const [dims, setDims] = useState<MDims>(() => defaultsFor(getModel('М7')))
  const [thickness, setThickness] = useState(8)
  const [finishId, setFinishId] = useState<FinishId>('chrome')
  const [sent, setSent] = useState(false)

  const model = getModel(code)
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]

  function changeModel(c: string) {
    setCode(c)
    const m = getModel(c)
    setDims(defaultsFor(m))
    if (!m.thickness.includes(thickness)) setThickness(m.thickness[0])
  }
  const setD = <K extends keyof MDims>(k: K, v: MDims[K]) => setDims(d => ({ ...d, [k]: v }))

  const assembly = useMemo(() => buildFromModel(model, dims, thickness), [model, dims, thickness])
  const glassAreaM2 = Number(assembly.glass.reduce((s, g) => s + g.size[0] * g.size[1], 0).toFixed(2))
  const hinges = assembly.hardware.filter(h => h.model === 'balge' || h.model === 'dessau').length
  const handles = assembly.hardware.filter(h => h.model === 'sd210').length
  const slides = assembly.glass.filter(g => g.role === 'door' && !assembly.hardware.some(h => h.key.startsWith(g.key))).length
  const att = doorAttachment(model)

  function sendLead() {
    const payload = {
      type: 'mglass-shower-config' as const,
      config: { model: model.code, name: model.name, dims, thickness, finish: { id: finish.id, label: finish.label }, glassAreaM2 },
    }
    const origin = process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGIN || '*'
    try { window.parent?.postMessage(payload, origin) } catch { /* not embedded */ }
    setSent(true)
  }

  const c = model.constraints
  return (
    <div className={embed ? 'w-full px-4 py-5' : 'max-w-[1200px] mx-auto px-6 py-8'}>
      {!embed && (
        <div className="mb-6">
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Конфигуратор душевых</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Модель → размеры → стекло → финиш. 3D — вживую.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr_300px] gap-6">
        {/* Модель + параметры */}
        <div className="space-y-5">
          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Модель</label>
            <div className="grid gap-1.5">
              {M_MODELS.map(m => (
                <button key={m.code} onClick={() => changeModel(m.code)}
                  className={`text-left px-3 py-2 rounded-lg text-[13px] border transition-colors ${
                    code === m.code ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'
                  }`}>
                  <span className="font-mono">{m.code}</span> · {m.name}
                  <span className={`block text-[11px] ${code === m.code ? 'text-white/60' : 'text-[#9a9a95]'}`}>{m.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3.5 bg-white border border-[#e4e4e0] rounded-xl p-4">
            <Field label="Ширина" value={dims.width} min={c.width[0]} max={c.width[1]} onChange={v => setD('width', v)} />
            {c.needsWidth2 && c.width2 && (
              <Field label={model.shape === 'corner' ? 'Боковая' : 'Ширина 2'} value={dims.width2 ?? 0} min={c.width2[0]} max={c.width2[1]} onChange={v => setD('width2', v)} />
            )}
            <Field label="Высота" value={dims.height} min={c.height[0]} max={c.height[1]} onChange={v => setD('height', v)} />
            {c.doorWidth && (
              <Field label="Дверь" value={dims.doorWidth ?? 600} min={c.doorWidth[0]} max={c.doorWidth[1]} onChange={v => setD('doorWidth', v)} />
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-2">Стекло, мм</label>
            <div className="flex gap-1.5">
              {model.thickness.map(tk => (
                <button key={tk} onClick={() => setThickness(tk)}
                  className={`px-4 py-1.5 rounded-lg text-[13px] border ${thickness === tk ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0]'}`}>
                  {tk}
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
            <p className="text-[12px] text-[#6b6b66] mt-1.5">{finish.label}</p>
          </div>
        </div>

        {/* 3D */}
        <div className="min-w-0 space-y-3">
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-4">
            <Partition3DView model={model} dims={dims} thickness={thickness} finishHex={finish.hex} finishId={finish.id} />
          </div>
          <p className="text-[12px] text-[#9a9a95] text-center">
            {model.code} · {model.name}{att ? ` · дверь на ${att === 'стена' ? 'стене' : 'стекле'}, открывается наружу` : ''}
          </p>
        </div>

        {/* Спецификация */}
        <div className="space-y-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-3">Спецификация</p>
            <div className="text-[13px] flex justify-between py-1.5 border-b border-[#f0f0ec]">
              <span className="text-[#4b4b47]">Стекло {thickness} мм</span>
              <span className="font-mono text-[#111110]">{glassAreaM2} м²</span>
            </div>
            {hinges > 0 && (
              <div className="text-[13px] flex justify-between py-1.5 border-b border-[#f8f8f7]">
                <span className="text-[#4b4b47]">Петли ({finish.label})</span><span className="font-mono">{hinges} шт</span>
              </div>
            )}
            {handles > 0 && (
              <div className="text-[13px] flex justify-between py-1.5 border-b border-[#f8f8f7]">
                <span className="text-[#4b4b47]">Ручка-скоба SD-210</span><span className="font-mono">{handles} шт</span>
              </div>
            )}
            {slides > 0 && (
              <div className="text-[13px] flex justify-between py-1.5">
                <span className="text-[#4b4b47]">Раздвижная система РД-001</span><span className="font-mono">{slides} компл.</span>
              </div>
            )}
          </div>

          {embed ? (
            sent ? (
              <div className="bg-[#f0f7f0] border border-[#cfe6cf] rounded-xl p-4 text-center">
                <p className="text-[14px] font-semibold text-[#256029]">Заявка отправлена</p>
                <p className="text-[12px] text-[#4b6b4b] mt-1">Менеджер рассчитает точную цену и свяжется с вами.</p>
              </div>
            ) : (
              <button onClick={sendLead}
                className="w-full bg-[#111110] text-white text-[14px] font-medium py-3 rounded-lg hover:bg-[#2a2a28]">
                Оставить заявку — рассчитаем точную цену
              </button>
            )
          ) : (
            <p className="text-[12px] text-[#9a9a95]">Внутренний вид. Цена и КП — через основной калькулятор.</p>
          )}
        </div>
      </div>
    </div>
  )
}
