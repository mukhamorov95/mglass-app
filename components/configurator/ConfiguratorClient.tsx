'use client'

import { useEffect, useMemo, useState } from 'react'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import { FINISHES, type FinishId } from '@/lib/configurator/catalog'
import { M_MODELS, getModel, doorAttachment, type MModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type MDims, type GlassTint, type HardwareChoice } from '@/components/configurator/scene/assembly'
import { computeQuantities, totalMeters, HARDWARE_LABEL, type PriceResult, type HardwareOption } from '@/lib/configurator/pricing'

type Quote = { full: boolean; price?: PriceResult; total?: number; clientFrom?: number }
const ROLE_TITLE: Record<string, string> = { hinge: 'Петля', handle: 'Ручка' }

const THICKNESS = 8   // душевые — только 8 мм закалённое

// Тип/цвет стекла (тон в 3D через MeshTransmissionMaterial).
type GlassType = { id: string; label: string; swatch: string; tint: GlassTint }
const GLASS_TYPES: GlassType[] = [
  { id: 'clear',    label: 'Прозрачное М1',              swatch: '#cfe3d3', tint: { color: '#dcebe0', attenuation: '#a3c6ab', distance: 1.35 } },
  { id: 'crystal',  label: 'Осветлённое Crystal Vision', swatch: '#dfeaf6', tint: { color: '#e9f2fb', attenuation: '#c4daef', distance: 3.2 } },
  { id: 'bronze',   label: 'Тонированная бронза',        swatch: '#b0895c', tint: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 } },
  { id: 'graphite', label: 'Тонированная графит',        swatch: '#7f858b', tint: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 } },
]

// Тариф: бюджет — узкий набор цветов фурнитуры; премиум — все.
type Tier = 'budget' | 'premium'
const BUDGET_FINISHES = new Set(['chrome', 'black', 'white'])
const finishesFor = (t: Tier) => t === 'budget' ? FINISHES.filter(f => BUDGET_FINISHES.has(f.id)) : FINISHES

const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

function defaultsFor(m: MModel): MDims {
  return {
    width: mid(m.constraints.width),
    height: Math.min(2000, m.constraints.height[1]),
    width2: m.constraints.needsWidth2 && m.constraints.width2 ? mid(m.constraints.width2) : undefined,
    doorWidth: m.constraints.doorWidth ? 600 : undefined,
  }
}

// Размер: слайдер + ручной ввод в мм.
function Field({ label, value, min, max, step = 10, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <label className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">{label}</label>
        <div className="flex items-center gap-1">
          <input type="number" value={value} min={min} max={max} step={step}
            onChange={e => onChange(clamp(Number(e.target.value) || 0, min, max))}
            className="w-[68px] text-right text-[13px] font-mono text-[#111110] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
          <span className="text-[11px] text-[#9a9a95]">мм</span>
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} className="w-full accent-[#111110]" />
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="text-[13px] flex justify-between py-1">
      <span className={muted ? 'text-[#9a9a95]' : 'text-[#4b4b47]'}>{label}</span>
      <span className={`font-mono ${muted ? 'text-[#6b6b66]' : 'text-[#111110]'}`}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-3">{title}</p>
      {children}
    </div>
  )
}

// Клиентский визуализатор на 9 моделях М1–М12 (раскладка — lib/configurator/arrangement).
// Раскладка экрана: модель (сворачивается) слева · 3D по центру (sticky, всегда виден) ·
// габариты/стекло/цвет + спецификация + цена справа. variant='embed' — публичный виджет.
export function ConfiguratorClient({ variant = 'internal' }: { variant?: 'internal' | 'embed' }) {
  const embed = variant === 'embed'
  const [code, setCode] = useState<string>('М7')
  const [dims, setDims] = useState<MDims>(() => defaultsFor(getModel('М7')))
  const [tier, setTier] = useState<Tier>('budget')
  const [finishId, setFinishId] = useState<FinishId>('chrome')
  const [glassId, setGlassId] = useState<string>('clear')
  const [modelOpen, setModelOpen] = useState(true)
  const [doorOpen, setDoorOpen] = useState(true)
  const [sent, setSent] = useState(false)
  const [options, setOptions] = useState<Record<string, HardwareOption[]>>({})
  const [choice, setChoice] = useState<Record<string, string>>({})

  const finishOptions = finishesFor(tier)
  function changeTier(t: Tier) {
    setTier(t)
    const opts = finishesFor(t)
    if (!opts.some(f => f.id === finishId)) setFinishId(opts[0].id as FinishId)
  }

  const model = getModel(code)
  const finish = FINISHES.find(f => f.id === finishId) ?? FINISHES[0]
  const glass = GLASS_TYPES.find(g => g.id === glassId) ?? GLASS_TYPES[0]

  function changeModel(c: string) {
    setCode(c)
    setDims(defaultsFor(getModel(c)))
    setModelOpen(false)   // выбрал → сворачиваем список, освобождаем экран
  }
  const setD = <K extends keyof MDims>(k: K, v: MDims[K]) => setDims(d => ({ ...d, [k]: v }))

  const assembly = useMemo(() => buildFromModel(model, dims, THICKNESS), [model, dims])
  const quantities = useMemo(() => computeQuantities(assembly, THICKNESS), [assembly])

  // Варианты фурнитуры (петля/ручка) из тарифа — для выбора клиентом (без себеста).
  useEffect(() => {
    fetch(`/api/configurator/options?tier=${tier}`).then(r => (r.ok ? r.json() : null)).then(d => {
      if (!d) return
      const opts: Record<string, HardwareOption[]> = d.options ?? {}
      setOptions(opts)
      setChoice(prev => {
        const next = { ...prev }
        for (const role of Object.keys(opts)) if (!opts[role].some(o => o.key === next[role])) next[role] = opts[role][0]?.key
        return next
      })
    }).catch(() => {})
  }, [tier])
  // выбранные ключи → shape для 3D
  const hwChoice = useMemo<HardwareChoice>(() => {
    const shapeOf = (role: string) => options[role]?.find(o => o.key === choice[role])?.shape
    return { hinge: shapeOf('hinge'), handle: shapeOf('handle') }
  }, [options, choice])

  // Цена — с СЕРВЕРА (себестоимость не уходит в браузер). Спецификация — мгновенно на клиенте.
  const [quote, setQuote] = useState<Quote | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    const id = setTimeout(() => {
      fetch('/api/configurator/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model: code, dims, thickness: THICKNESS, tier, glassType: glassId, finishId, choice }),
      }).then(r => (r.ok ? r.json() : null)).then(q => { if (q) setQuote(q) }).catch(() => {})
    }, 250)
    return () => { clearTimeout(id); ctrl.abort() }
  }, [code, dims, tier, glassId, finishId, choice])
  const price = quote?.price ?? null
  const clientFrom = quote?.clientFrom ?? (price ? Math.floor(price.total / 100) * 100 : null)
  const att = doorAttachment(model)
  const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`
  const c = model.constraints

  function sendLead() {
    const payload = {
      type: 'mglass-shower-config' as const,
      config: {
        model: model.code, name: model.name, dims, thickness: THICKNESS, tier,
        glass: { id: glass.id, label: glass.label },
        finish: { id: finish.id, label: finish.label },
        glassAreaM2: quantities.glassM2, sections: quantities.sections,
        priceFrom: clientFrom ?? 0,
      },
    }
    const origin = process.env.NEXT_PUBLIC_EMBED_PARENT_ORIGIN || '*'
    try { window.parent?.postMessage(payload, origin) } catch { /* not embedded */ }
    setSent(true)
  }

  return (
    <div className={embed ? 'w-full px-4 py-5' : 'max-w-[1280px] mx-auto px-6 py-6'}>
      {!embed && (
        <div className="mb-5">
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Визуализатор 3D</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Модель → размеры → стекло → цвет. 3D-душевая — вживую.</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[250px_1fr_330px] gap-5 items-start">
        {/* ── Тариф + Модель (сворачивается) ── */}
        <div className="lg:sticky lg:top-4 space-y-3">
          <div className="inline-flex w-full rounded-lg border border-[#e4e4e0] overflow-hidden text-[13px] font-medium">
            <button onClick={() => changeTier('budget')}
              className={`flex-1 py-2 ${tier === 'budget' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Бюджет</button>
            <button onClick={() => changeTier('premium')}
              className={`flex-1 py-2 ${tier === 'premium' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Премиум</button>
          </div>
          {modelOpen ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">Модель</label>
              </div>
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
          ) : (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-1">Модель</p>
              <p className="text-[14px] font-semibold text-[#111110]"><span className="font-mono">{model.code}</span> · {model.name}</p>
              <p className="text-[12px] text-[#9a9a95] mt-0.5">{model.desc}</p>
              <button onClick={() => setModelOpen(true)}
                className="mt-3 w-full text-[13px] font-medium border border-[#e4e4e0] rounded-lg py-2 hover:border-[#111110]">
                Сменить модель
              </button>
            </div>
          )}
        </div>

        {/* ── 3D (всегда виден) ── */}
        <div className="min-w-0 lg:sticky lg:top-4 space-y-2">
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-3">
            <Partition3DView model={model} dims={dims} thickness={THICKNESS}
              finishHex={finish.hex} finishId={finish.id} glassTint={glass.tint} doorOpen={doorOpen} choice={hwChoice} />
          </div>
          <div className="flex items-center justify-center gap-3">
            <p className="text-[12px] text-[#9a9a95]">
              {model.code} · {model.name}{att ? ` · дверь на ${att === 'стена' ? 'стене' : 'стекле'}` : ''}
            </p>
            {att && (
              <button onClick={() => setDoorOpen(v => !v)}
                className="text-[12px] font-medium border border-[#e4e4e0] rounded-lg px-3 py-1 hover:border-[#111110]">
                {doorOpen ? 'Закрыть дверь' : 'Открыть дверь'}
              </button>
            )}
          </div>
        </div>

        {/* ── Параметры + спецификация + цена ── */}
        <div className="space-y-4">
          <Section title="Габариты">
            <div className="space-y-3.5">
              <Field label="Ширина" value={dims.width} min={c.width[0]} max={c.width[1]} onChange={v => setD('width', v)} />
              {c.needsWidth2 && c.width2 && (
                <Field label={model.shape === 'corner' ? 'Боковая' : 'Ширина 2'} value={dims.width2 ?? 0} min={c.width2[0]} max={c.width2[1]} onChange={v => setD('width2', v)} />
              )}
              <Field label="Высота" value={dims.height} min={c.height[0]} max={c.height[1]} onChange={v => setD('height', v)} />
              {c.doorWidth && (
                <Field label="Дверь" value={dims.doorWidth ?? 600} min={c.doorWidth[0]} max={c.doorWidth[1]} onChange={v => setD('doorWidth', v)} />
              )}
            </div>
          </Section>

          <Section title="Стекло">
            <div className="grid grid-cols-2 gap-1.5">
              {GLASS_TYPES.map(g => (
                <button key={g.id} onClick={() => setGlassId(g.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left text-[12px] ${
                    glassId === g.id ? 'border-[#111110] bg-[#fafafa]' : 'border-[#e4e4e0] hover:border-[#c4c4be]'
                  }`}>
                  <span className="w-5 h-5 rounded-full flex-none border border-black/10" style={{ background: g.swatch }} />
                  <span className="text-[#4b4b47] leading-tight">{g.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-2">Закалённое 8 мм</p>
          </Section>

          <Section title="Цвет фурнитуры">
            <div className="grid grid-cols-5 gap-1.5">
              {finishOptions.map(f => (
                <button key={f.id} onClick={() => setFinishId(f.id)} title={f.label}
                  className={`h-9 rounded-lg border-2 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`}
                  style={{ background: f.hex }} />
              ))}
            </div>
            <p className="text-[12px] text-[#6b6b66] mt-1.5">{finish.label}{tier === 'budget' ? ' · бюджет' : ' · премиум'}</p>
          </Section>

          {/* Выбор фурнитуры (петля/ручка) — если для модели роль есть и вариантов ≥2 */}
          {['hinge', 'handle'].map(role => {
            const opts = options[role]
            if (!opts || opts.length < 2 || (quantities.roles[role] ?? 0) <= 0) return null
            return (
              <Section key={role} title={ROLE_TITLE[role] ?? role}>
                <div className="grid grid-cols-1 gap-1.5">
                  {opts.map(o => (
                    <button key={o.key} onClick={() => setChoice(c => ({ ...c, [role]: o.key }))}
                      className={`px-2.5 py-2 rounded-lg border text-left text-[12px] ${
                        choice[role] === o.key ? 'border-[#111110] bg-[#fafafa]' : 'border-[#e4e4e0] hover:border-[#c4c4be]'
                      }`}>
                      <span className="text-[#4b4b47] leading-tight">{o.name}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )
          })}

          <Section title="Спецификация">
            <Row label="Секции (полотна)" value={`${quantities.sections}`} />
            <Row label="Стекло 8 мм" value={`${quantities.glassM2} м²`} />
            {(quantities.profilePieces.length + quantities.tubePieces.length) > 0 && (
              <Row label="Профиль + штанга" value={`${(totalMeters(quantities.profilePieces) + totalMeters(quantities.tubePieces)).toFixed(2)} м.п.`} />
            )}
            {Object.entries(quantities.hardware).map(([m, qty]) => (
              <Row key={m} label={HARDWARE_LABEL[m] ?? m} value={`${qty} шт`} />
            ))}
          </Section>

          {embed ? (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] text-[#6b6b66]">Цена</span>
                <span className="text-[22px] font-semibold text-[#111110] font-mono">{clientFrom != null ? `от ${rub(clientFrom)}` : '…'}</span>
              </div>
              <p className="text-[11px] text-[#9a9a95] mt-1">Предварительно. Точную цену рассчитает менеджер.</p>
            </div>
          ) : price ? (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <Row label="Себестоимость стекла" value={rub(price.glassCost)} muted />
              <Row label="Себестоимость фурнитуры" value={rub(price.hardwareCost + price.profileCost + price.tubeCost)} muted />
              <Row label={`Цена изделия (маржа ${price.marginPct}% / налог ${price.taxPct}%)`} value={rub(price.itemPrice)} />
              <Row label={`Монтаж (${quantities.sections}×${(price.installCost / Math.max(1, quantities.sections)).toLocaleString('ru-RU')} ₽)`} value={rub(price.installCost)} muted />
              <Row label="Доставка (Москва)" value={rub(price.deliveryCost)} muted />
              <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-[#e4e4e0]">
                <span className="text-[13px] font-semibold text-[#111110]">Сумма изделия</span>
                <span className="text-[19px] font-semibold text-[#111110] font-mono">{rub(price.total)}</span>
              </div>
              <p className="text-[11px] text-[#9a9a95] pt-1">Ставки — из «Себестоимость визуализатора» (админка).</p>
            </div>
          ) : (
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 text-[13px] text-[#9a9a95]">Считаем цену…</div>
          )}

          {embed && (
            sent ? (
              <div className="bg-[#f0f7f0] border border-[#cfe6cf] rounded-xl p-4 text-center">
                <p className="text-[14px] font-semibold text-[#256029]">Заявка отправлена</p>
                <p className="text-[12px] text-[#4b6b4b] mt-1">Менеджер свяжется с вами.</p>
              </div>
            ) : (
              <button onClick={sendLead}
                className="w-full bg-[#111110] text-white text-[14px] font-medium py-3 rounded-lg hover:bg-[#2a2a28]">
                Оставить заявку
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}
