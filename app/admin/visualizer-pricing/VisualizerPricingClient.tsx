'use client'

import { useMemo, useState } from 'react'
import { Partition3DView } from '@/components/configurator/Partition3DView'
import { FINISHES } from '@/lib/configurator/catalog'
import { M_MODELS, getModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type GlassTint } from '@/components/configurator/scene/assembly'
import {
  computeQuantities, computePrice, totalMeters, HARDWARE_LABEL, HARDWARE_MODELS,
  GLASS_TYPE_IDS, DEFAULT_FINANCE, type Tier, type UnitPrices,
} from '@/lib/configurator/pricing'

const GLASS_LABEL: Record<string, string> = {
  clear: 'Прозрачное М1', crystal: 'Осветлённое Crystal Vision', bronze: 'Тонированная бронза', graphite: 'Тонированная графит',
}
const TINT: Record<string, GlassTint> = {
  clear: { color: '#dcebe0', attenuation: '#a3c6ab', distance: 1.35 },
  crystal: { color: '#e9f2fb', attenuation: '#c4daef', distance: 3.2 },
  bronze: { color: '#d6bd97', attenuation: '#7a5836', distance: 1.2 },
  graphite: { color: '#b9bec4', attenuation: '#4f555d', distance: 1.1 },
}
const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`

function Num({ label, value, onChange, suffix = '₽' }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[13px] py-0.5">
      <span className="text-[#4b4b47]">{label}</span>
      <span className="flex items-center gap-1">
        <input type="number" value={value} onChange={e => onChange(Number(e.target.value) || 0)}
          className="w-[96px] text-right font-mono text-[#111110] border border-[#e4e4e0] rounded-md px-1.5 py-0.5 focus:border-[#111110] outline-none" />
        <span className="text-[11px] text-[#9a9a95] w-8">{suffix}</span>
      </span>
    </label>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85] mb-2">{title}</p>
      {children}
    </div>
  )
}

export function VisualizerPricingClient({ initial }: { initial: Record<Tier, UnitPrices> }) {
  const [tier, setTier] = useState<Tier>('budget')
  const [prices, setPrices] = useState<Record<Tier, UnitPrices>>(initial)
  const [code, setCode] = useState('М7')
  const [glassType, setGlassType] = useState('clear')
  const [finishId, setFinishId] = useState('chrome')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const up = prices[tier]
  const model = getModel(code)
  const dims = useMemo(() => {
    const c = model.constraints
    const mid = ([a, b]: [number, number]) => Math.round((a + b) / 200) * 100
    return {
      width: mid(c.width), height: Math.min(2000, c.height[1]),
      width2: c.needsWidth2 && c.width2 ? mid(c.width2) : undefined,
      doorWidth: c.doorWidth ? 600 : undefined,
    }
  }, [model])

  const assembly = useMemo(() => buildFromModel(model, dims, 8), [model, dims])
  const q = useMemo(() => computeQuantities(assembly, 8), [assembly])
  const price = useMemo(() => computePrice(q, up, DEFAULT_FINANCE, { glassType, finishId }), [q, up, glassType, finishId])

  function edit(mutate: (u: UnitPrices) => void) {
    setPrices(prev => {
      const next = structuredClone(prev)
      mutate(next[tier])
      return next
    })
    setDirty(true); setMsg(null)
  }

  async function save() {
    setSaving(true); setMsg(null)
    try {
      const res = await fetch('/api/admin/configurator-pricing', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, data: prices[tier] }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Ошибка сохранения')
      setDirty(false); setMsg('Сохранено')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Ошибка') }
    finally { setSaving(false) }
  }

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Себестоимость визуализатора</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5">Цены по тарифу. Меняешь здесь → сразу в расчёте у клиента.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className={`text-[13px] ${msg === 'Сохранено' ? 'text-[#256029]' : 'text-red-600'}`}>{msg}</span>}
          <button onClick={save} disabled={!dirty || saving}
            className={`text-[13px] font-medium px-4 py-2 rounded-lg ${dirty && !saving ? 'bg-[#111110] text-white hover:bg-[#2a2a28]' : 'bg-[#eee] text-[#9a9a95]'}`}>
            {saving ? 'Сохраняю…' : `Сохранить ${tier === 'budget' ? 'Бюджет' : 'Премиум'}`}
          </button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-[#e4e4e0] overflow-hidden text-[13px] font-medium mb-5">
        <button onClick={() => setTier('budget')} className={`px-5 py-2 ${tier === 'budget' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Бюджет</button>
        <button onClick={() => setTier('premium')} className={`px-5 py-2 ${tier === 'premium' ? 'bg-[#111110] text-white' : 'bg-white text-[#4b4b47]'}`}>Премиум</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr_360px] gap-5 items-start">
        {/* Модели */}
        <div className="grid gap-1.5 lg:sticky lg:top-4">
          {M_MODELS.map(m => (
            <button key={m.code} onClick={() => setCode(m.code)}
              className={`text-left px-3 py-2 rounded-lg text-[13px] border ${code === m.code ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#4b4b47] border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
              <span className="font-mono">{m.code}</span> · {m.name}
            </button>
          ))}
        </div>

        {/* 3D + спецификация модели + расчёт */}
        <div className="min-w-0 space-y-3 lg:sticky lg:top-4">
          <div className="bg-[#fafaf9] border border-[#e4e4e0] rounded-xl p-3">
            <Partition3DView model={model} dims={dims} thickness={8} finishHex={FINISHES.find(f => f.id === finishId)?.hex ?? '#c9ccd0'} finishId={finishId} glassTint={TINT[glassType]} />
          </div>
          <Card title={`Спецификация ${model.code} и себестоимость`}>
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Стекло {GLASS_LABEL[glassType]}</span><span className="font-mono">{q.glassM2} м² · {rub(price.glassCost)}</span></div>
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Профиль Pr-002 (хлысты)</span><span className="font-mono">{totalMeters(q.profilePieces)} м.п. · {rub(price.profileCost)}</span></div>
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Штанга 30×10 (хлысты)</span><span className="font-mono">{totalMeters(q.tubePieces)} м.п. · {rub(price.tubeCost)}</span></div>
            {price.hardwareLines.map(l => (
              <div key={l.key} className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">{l.label}</span><span className="font-mono">{l.qty}×{rub(l.unitPrice)} = {rub(l.total)}</span></div>
            ))}
            <div className="flex justify-between text-[13px] pt-2 mt-1 border-t border-[#f0f0ec]"><span className="text-[#6b6b66]">Себестоимость</span><span className="font-mono">{rub(price.materialsCost)}</span></div>
            <div className="flex justify-between text-[13px] py-0.5"><span className="text-[#4b4b47]">Цена изделия ({price.marginPct}/{price.taxPct}%)</span><span className="font-mono">{rub(price.itemPrice)}</span></div>
            <div className="flex justify-between text-[13px]"><span className="text-[#4b4b47]">Монтаж {q.sections}×{rub(up.installPerSection)} + доставка</span><span className="font-mono">{rub(price.installCost + price.deliveryCost)}</span></div>
            <div className="flex justify-between text-[14px] font-semibold pt-1"><span>Сумма изделия</span><span className="font-mono">{rub(price.total)}</span></div>
          </Card>
        </div>

        {/* Редактор цен тарифа */}
        <div className="space-y-3">
          <Card title="Стекло · ₽/м²">
            {GLASS_TYPE_IDS.map(g => (
              <Num key={g} label={GLASS_LABEL[g]} value={up.glassPerM2[g] ?? 0} onChange={v => edit(u => { u.glassPerM2[g] = v })} suffix="₽/м²" />
            ))}
            <p className="text-[11px] text-[#9a9a95] mt-1">Тип для превью: {GLASS_TYPE_IDS.map(g => (
              <button key={g} onClick={() => setGlassType(g)} className={`ml-1 underline ${glassType === g ? 'text-[#111110] font-semibold' : ''}`}>{GLASS_LABEL[g].split(' ')[0]}</button>
            ))}</p>
          </Card>

          <Card title="Профиль Pr-002 · хлысты">
            {up.profileStock.map((s, i) => (
              <Num key={s.len} label={`Хлыст ${s.len} мм`} value={s.price} onChange={v => edit(u => { u.profileStock[i].price = v })} />
            ))}
          </Card>
          <Card title="Штанга 30×10 · хлысты">
            {up.tubeStock.map((s, i) => (
              <Num key={s.len} label={`Хлыст ${s.len} мм`} value={s.price} onChange={v => edit(u => { u.tubeStock[i].price = v })} />
            ))}
          </Card>

          <Card title="Фурнитура · ₽/шт по цвету">
            <div className="flex flex-wrap gap-1 mb-2">
              {FINISHES.map(f => (
                <button key={f.id} onClick={() => setFinishId(f.id)} title={f.label}
                  className={`w-6 h-6 rounded border-2 ${finishId === f.id ? 'border-[#111110]' : 'border-[#e4e4e0]'}`} style={{ background: f.hex }} />
              ))}
            </div>
            <p className="text-[11px] text-[#9a9a95] mb-1">Цвет: {FINISHES.find(f => f.id === finishId)?.label}</p>
            {HARDWARE_MODELS.map(m => (
              <Num key={m} label={HARDWARE_LABEL[m] ?? m} value={up.hardware[m]?.[finishId] ?? 0}
                onChange={v => edit(u => { u.hardware[m] = { ...(u.hardware[m] ?? {}), [finishId]: v } })} />
            ))}
          </Card>

          <Card title="Работы и логистика">
            <Num label="Монтаж за секцию" value={up.installPerSection} onChange={v => edit(u => { u.installPerSection = v })} />
            <Num label="Доставка Москва" value={up.deliveryMoscow} onChange={v => edit(u => { u.deliveryMoscow = v })} />
            <Num label="Подъём за этаж" value={up.liftPerFloor} onChange={v => edit(u => { u.liftPerFloor = v })} />
          </Card>
        </div>
      </div>
    </div>
  )
}
