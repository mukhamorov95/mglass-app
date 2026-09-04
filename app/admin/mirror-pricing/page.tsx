'use client'

import { useEffect, useMemo, useState } from 'react'

// «Себестоимость зеркал» — роль → позиция → цена, как «Себестоимость душевых».
// Разница в источнике: цены берём из прайса Eleganz, который уже ведётся и
// пересчитывается по курсу ЦБ. Руками цены не вводим — владелец: «в прайсе
// поставщика уже указано всё».

type Role = { role: string; label: string; match: string[]; hint: string }
type Comp = {
  id: number; component_type: string; name: string; unit: string; cost_price: number; active: boolean
  voltage: number | null; power_per_meter: number | null; max_power: number | null; pack_length_m: number | null
  source_supplier: string | null; source_item_id: number | null; price_updated_at: string | null
}
type PriceItem = {
  id: number; category: string; name: string; article: string | null
  price_usd: number | null; price_rub: number | null; currency: string | null; unit: string | null
}

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[13px] outline-none focus:border-[#111110]'

export default function MirrorPricingPage() {
  const [roles, setRoles] = useState<Role[]>([])
  const [comps, setComps] = useState<Comp[]>([])
  const [items, setItems] = useState<PriceItem[]>([])
  const [rate, setRate] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pickFor, setPickFor] = useState<Role | null>(null)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // Параметры, которые прайс не знает: Вт/м у ленты, мощность БП, длина бухты.
  const [extra, setExtra] = useState({ voltage: '', power_per_meter: '', max_power: '', pack_length_m: '' })

  async function load() {
    try {
      const r = await fetch('/api/admin/mirror-pricing')
      const j = await r.json().catch(() => ({}))
      if (r.ok) { setRoles(j.roles ?? []); setComps(j.components ?? []); setItems(j.priceItems ?? []); setRate(Number(j.rate) || 0) }
    } finally { setLoading(false) }
  }
  // Загрузка в эффекте, но setState — только в колбэках промиса: синхронный
  // setState в теле эффекта запускает каскад перерисовок (правило react-hooks).
  useEffect(() => { void load() }, [])

  const ofRole = (role: string) => comps.filter(c => c.component_type === role && c.active && Number(c.cost_price) > 0)

  const candidates = useMemo(() => {
    if (!pickFor) return []
    const s = q.trim().toLowerCase()
    return items
      .filter(i => pickFor.match.some(m => i.category.toLowerCase().includes(m.toLowerCase())))
      .filter(i => !s || i.name.toLowerCase().includes(s) || (i.article ?? '').toLowerCase().includes(s))
      .slice(0, 200)
  }, [items, pickFor, q])

  const priceOf = (i: PriceItem) =>
    i.currency === 'RUB' || i.price_usd == null ? Math.round(Number(i.price_rub) || 0) : Math.round(Number(i.price_usd) * rate)

  async function pick(item: PriceItem) {
    if (!pickFor) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/mirror-pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pick', role: pickFor.role, item_id: item.id,
          voltage: extra.voltage ? Number(extra.voltage) : null,
          power_per_meter: extra.power_per_meter ? Number(extra.power_per_meter) : null,
          max_power: extra.max_power ? Number(extra.max_power) : null,
          pack_length_m: extra.pack_length_m ? Number(extra.pack_length_m) : null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok) { setPickFor(null); setQ(''); setExtra({ voltage: '', power_per_meter: '', max_power: '', pack_length_m: '' }); await load() }
      else setMsg(j.error ?? 'Не удалось добавить')
    } finally { setBusy(false) }
  }

  async function refresh() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/admin/mirror-pricing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }),
      })
      const j = await r.json().catch(() => ({}))
      setMsg(r.ok ? `Пересчитано позиций: ${j.updated}` : (j.error ?? 'Не удалось пересчитать'))
      if (r.ok) await load()
    } finally { setBusy(false) }
  }

  if (loading) return <div className="p-6 text-[13px] text-[#9a9a95]">Загрузка…</div>

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Себестоимость зеркал</h1>
          <p className="text-[12.5px] text-[#9a9a95] mt-0.5 max-w-[70ch]">
            Позиции берутся из прайса Eleganz — руками цены не вводим. Прайс в долларах,
            поэтому рубли фиксируются на момент выбора; изменился курс — жмите «Пересчитать».
          </p>
        </div>
        <div className="text-right">
          <p className="text-[12px] text-[#9a9a95]">курс с наценкой</p>
          <p className="text-[15px] font-semibold font-mono text-[#111110]">{rate ? `${rate.toFixed(2)} ₽/$` : '—'}</p>
          <button onClick={refresh} disabled={busy}
            className="mt-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-[#e4e4e0] hover:border-[#111110] disabled:opacity-40">
            Пересчитать по курсу
          </button>
        </div>
      </div>

      {msg && <p className="text-[12.5px] text-[#4b4b47] bg-[#f0f0ec] rounded-lg px-3 py-2 mb-3">{msg}</p>}

      <div className="space-y-2.5">
        {roles.map(r => {
          const list = ofRole(r.role)
          return (
            <div key={r.role} className={`bg-white border rounded-2xl p-4 ${list.length ? 'border-[#e4e4e0]' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-[#111110]">
                    {list.length ? '✓' : '•'} {r.label}
                    <span className="text-[11.5px] font-normal text-[#9a9a95]"> {r.hint}</span>
                  </p>
                  {list.length === 0 && <p className="text-[12px] text-amber-800 mt-0.5">позиция не выбрана — расчёт зеркала её попросит</p>}
                </div>
                <button onClick={() => { setPickFor(r); setQ('') }}
                  className="text-[12.5px] font-semibold px-3 py-1.5 rounded-lg border border-[#111110] text-[#111110] hover:bg-[#111110] hover:text-white transition-colors whitespace-nowrap">
                  Выбрать из прайса
                </button>
              </div>

              {list.length > 0 && (
                <div className="mt-2 divide-y divide-[#f0f0ec]">
                  {list.map(c => (
                    <div key={c.id} className="py-1.5 flex items-center justify-between gap-3">
                      <span className="text-[12.5px] text-[#4b4b47] min-w-0">
                        {c.name}
                        <span className="text-[#9a9a95]">
                          {c.voltage ? ` · ${c.voltage} В` : ''}{c.power_per_meter ? ` · ${c.power_per_meter} Вт/м` : ''}
                          {c.max_power ? ` · до ${c.max_power} Вт` : ''}{c.pack_length_m ? ` · бухта ${c.pack_length_m} м` : ''}
                          {c.source_item_id ? ' · из прайса' : ' · вручную'}
                        </span>
                      </span>
                      <span className="text-[13px] font-mono font-semibold whitespace-nowrap">{RUB(Number(c.cost_price))}/{c.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11.5px] text-[#9a9a95] mt-4">
        Ручной ввод и редактирование остались на прежнем экране «Компоненты подсветки» — там же выключаются лишние позиции.
      </p>

      {/* Подбор позиции из прайса поставщика. */}
      {pickFor && (
        <div className="fixed inset-0 z-50 bg-black/25 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={() => setPickFor(null)}>
          <div className="bg-white w-full sm:max-w-2xl max-h-[85vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[#f0f0ec] flex items-center justify-between gap-3">
              <p className="text-[14px] font-semibold text-[#111110]">{pickFor.label} — из прайса Eleganz</p>
              <button onClick={() => setPickFor(null)} className="text-[13px] text-[#9a9a95] hover:text-[#111110]">закрыть</button>
            </div>

            <div className="px-4 py-2 border-b border-[#f0f0ec] space-y-2">
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по названию или артикулу"
                className={fld} />
              {/* Прайс не знает наших параметров — спрашиваем их здесь, один раз. */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {pickFor.role === 'led_strip' && <>
                  <input value={extra.voltage} onChange={e => setExtra(x => ({ ...x, voltage: e.target.value }))} placeholder="Вольт (12/24)" className={fld} />
                  <input value={extra.power_per_meter} onChange={e => setExtra(x => ({ ...x, power_per_meter: e.target.value }))} placeholder="Вт/м" className={fld} />
                  <input value={extra.pack_length_m} onChange={e => setExtra(x => ({ ...x, pack_length_m: e.target.value }))} placeholder="Бухта, м (5)" className={fld} />
                </>}
                {pickFor.role === 'power_supply' && <>
                  <input value={extra.voltage} onChange={e => setExtra(x => ({ ...x, voltage: e.target.value }))} placeholder="Вольт (12/24)" className={fld} />
                  <input value={extra.max_power} onChange={e => setExtra(x => ({ ...x, max_power: e.target.value }))} placeholder="Макс. Вт" className={fld} />
                </>}
                {pickFor.role === 'diffuser' && (
                  <input value={extra.pack_length_m} onChange={e => setExtra(x => ({ ...x, pack_length_m: e.target.value }))} placeholder="Хлыст, м (6)" className={fld} />
                )}
              </div>
            </div>

            <div className="overflow-y-auto divide-y divide-[#f0f0ec]">
              {candidates.length === 0 && <p className="px-4 py-6 text-[13px] text-[#9a9a95]">В прайсе ничего не нашлось.</p>}
              {candidates.map(i => (
                <button key={i.id} onClick={() => pick(i)} disabled={busy}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#fafaf9] flex items-center justify-between gap-3 disabled:opacity-40">
                  <span className="min-w-0">
                    <span className="block text-[13px] text-[#111110]">{i.name}</span>
                    <span className="block text-[11px] text-[#9a9a95]">{i.category}{i.article ? ` · ${i.article}` : ''}</span>
                  </span>
                  <span className="text-[13px] font-mono font-semibold whitespace-nowrap">
                    {RUB(priceOf(i))}/{i.unit}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
