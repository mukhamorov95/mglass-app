'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { DEFAULT_PRODUCTION_SETTINGS, type ProductionSettings } from '@/lib/calcServiceCost'
import { sandblastCost } from '@/lib/pricing/sandblastCost'

// Помощник по себестоимости пескоструя. Владелец: «точной суммы у меня нет,
// не знаю, как её посчитать». Считает не экран, а lib/pricing/sandblastCost.ts;
// здесь только поля процесса и честный список того, чего не хватает.
// Сохраняются ТОЛЬКО исходные числа процесса (process_cost_inputs); цены услуг
// экран не трогает — в конце показывает, какие три числа вписать в услугу.

const L = 'block text-[11px] font-medium text-[#6b6b66] mb-1'
const I = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white font-mono'
const num = (v: string) => { const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0 }
const rub = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })

type Svc = { id: number; name: string; cost_price: number | null; value: number | null; unit_label: string | null; active: boolean | null; time_minutes: number | null; consumables_cost_rub: number | null; equipment_depr_rub: number | null }

export default function SandblastCostPage() {
  const supabase = createClient()
  const [ps, setPs] = useState<ProductionSettings>(DEFAULT_PRODUCTION_SETTINGS)
  const [svcs, setSvcs] = useState<Svc[]>([])

  // Числа живут в базе (process_cost_inputs): владелец собирает их не за один раз —
  // ширину рулона и вес мешка назвал сразу, расход песка и время меряют в цеху позже.
  const [rollPrice, setRollPrice] = useState('8000')
  const [rollLen, setRollLen] = useState('50')
  const [rollWidth, setRollWidth] = useState('1')
  const [layers, setLayers] = useState('1')
  const [waste, setWaste] = useState('10')

  const [bagPrice, setBagPrice] = useState('')
  const [bagKg, setBagKg] = useState('25')
  const [kgPerM2, setKgPerM2] = useState('')

  const [minutes, setMinutes] = useState('')

  const [eqPrice, setEqPrice] = useState('')
  const [eqYears, setEqYears] = useState('5')
  const [eqM2, setEqM2] = useState('')

  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: s }, { data: saved }] = await Promise.all([
        supabase.from('production_settings').select('*').eq('id', 1).maybeSingle(),
        supabase.from('b2b_services').select('id, name, cost_price, value, unit_label, active, time_minutes, consumables_cost_rub, equipment_depr_rub').ilike('name', '%пескостру%').order('id'),
        supabase.from('process_cost_inputs').select('inputs, updated_at').eq('process', 'sandblast').maybeSingle(),
      ])
      if (p) setPs(p as ProductionSettings)
      setSvcs((s ?? []) as Svc[])
      const v = (saved?.inputs ?? {}) as Record<string, unknown>
      const put = (k: string, f: (x: string) => void) => { if (v[k] != null && v[k] !== '') f(String(v[k])) }
      put('rollPrice', setRollPrice); put('rollLen', setRollLen); put('rollWidth', setRollWidth)
      put('layers', setLayers); put('waste', setWaste)
      put('bagPrice', setBagPrice); put('bagKg', setBagKg); put('kgPerM2', setKgPerM2)
      put('minutes', setMinutes); put('eqPrice', setEqPrice); put('eqYears', setEqYears); put('eqM2', setEqM2)
      if (saved?.updated_at) setSavedAt(saved.updated_at as string)
    })()
  }, [supabase])

  const minuteRate = ps.worker_monthly_salary / (ps.working_days_per_month * ps.working_hours_per_day * 60)

  const res = useMemo(() => sandblastCost({
    film: num(rollPrice) > 0 && num(rollLen) > 0 && num(rollWidth) > 0
      ? { rollPrice: num(rollPrice), rollLengthM: num(rollLen), rollWidthM: num(rollWidth), layers: num(layers), wastePct: num(waste) }
      : null,
    sand: num(bagPrice) > 0 && num(bagKg) > 0 && num(kgPerM2) > 0
      ? { bagPrice: num(bagPrice), bagKg: num(bagKg), kgPerM2: num(kgPerM2) }
      : null,
    minutesPerM2: num(minutes) > 0 ? num(minutes) : null,
    minuteRate,
    equipment: num(eqPrice) > 0 && num(eqYears) > 0 && num(eqM2) > 0
      ? { price: num(eqPrice), lifeYears: num(eqYears), m2PerMonth: num(eqM2) }
      : null,
    overheadPct: ps.overhead_percent,
  }), [rollPrice, rollLen, rollWidth, layers, waste, bagPrice, bagKg, kgPerM2, minutes, minuteRate, eqPrice, eqYears, eqM2, ps.overhead_percent])

  async function save() {
    setSaving(true)
    const inputs = { rollPrice, rollLen, rollWidth, layers, waste, bagPrice, bagKg, kgPerM2, minutes, eqPrice, eqYears, eqM2 }
    const { error } = await supabase.from('process_cost_inputs')
      .upsert({ process: 'sandblast', inputs, updated_at: new Date().toISOString() })
    setSaving(false)
    if (!error) setSavedAt(new Date().toISOString())
  }

  const consumables = res.lines.filter(l => l.name.startsWith('Плёнка') || l.name.startsWith('Песок')).reduce((s, l) => s + l.rubPerM2, 0)
  const equipment = res.lines.find(l => l.name.startsWith('Амортизация'))?.rubPerM2 ?? 0

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Себестоимость пескоструя</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">
              Заполните, что известно по процессу. Пустое поле не подставляется — оно попадает в список «чего не хватает».
            </p>
          </div>
          <div className="text-right">
            <button onClick={save} disabled={saving}
              className="px-4 py-2 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50">
              {saving ? 'Сохраняю…' : 'Сохранить числа'}
            </button>
            {savedAt && <p className="text-[11px] text-[#9a9a95] mt-1">сохранено {new Date(savedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>}
          </div>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Плёнка (оракал)</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label className={L}>Цена рулона, ₽</label><input className={I} value={rollPrice} onChange={e => setRollPrice(e.target.value)} /></div>
            <div><label className={L}>Длина, м</label><input className={I} value={rollLen} onChange={e => setRollLen(e.target.value)} /></div>
            <div><label className={L}>Ширина, м</label><input className={I} value={rollWidth} onChange={e => setRollWidth(e.target.value)} placeholder="?" /></div>
            <div><label className={L}>Слоёв на 1 м²</label><input className={I} value={layers} onChange={e => setLayers(e.target.value)} /></div>
            <div><label className={L}>Обрезки, %</label><input className={I} value={waste} onChange={e => setWaste(e.target.value)} /></div>
          </div>
          <p className="text-[11px] text-[#9a9a95]">
            Слоёв: 1 — если оклеивается только обратная сторона (полное матирование); 2 — если сверху ещё трафарет по лицевой.
          </p>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Песок</p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className={L}>Цена мешка, ₽</label><input className={I} value={bagPrice} onChange={e => setBagPrice(e.target.value)} placeholder="?" /></div>
            <div><label className={L}>Вес мешка, кг</label><input className={I} value={bagKg} onChange={e => setBagKg(e.target.value)} placeholder="?" /></div>
            <div><label className={L}>Расход, кг на м²</label><input className={I} value={kgPerM2} onChange={e => setKgPerM2(e.target.value)} placeholder="?" /></div>
          </div>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3">
          <p className="text-[13px] font-semibold text-[#111110]">Время и оборудование</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className={L}>Минут на 1 м²</label><input className={I} value={minutes} onChange={e => setMinutes(e.target.value)} placeholder="?" /></div>
            <div><label className={L}>Аппарат + компрессор + плоттер, ₽</label><input className={I} value={eqPrice} onChange={e => setEqPrice(e.target.value)} placeholder="?" /></div>
            <div><label className={L}>Служит, лет</label><input className={I} value={eqYears} onChange={e => setEqYears(e.target.value)} /></div>
            <div><label className={L}>Песочим, м² в месяц</label><input className={I} value={eqM2} onChange={e => setEqM2(e.target.value)} placeholder="?" /></div>
          </div>
          <p className="text-[11px] text-[#9a9a95]">
            Минута работы — {rub(Math.round(minuteRate * 100) / 100)} ₽ (оклад {ps.worker_monthly_salary.toLocaleString('ru-RU')} ₽ ÷ {ps.working_days_per_month} дн × {ps.working_hours_per_day} ч).
            Накладные — {ps.overhead_percent}%. Обе величины из настроек производства, не отсюда.
          </p>
        </div>

        <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-2">
          <p className="text-[13px] font-semibold text-[#111110]">Себестоимость 1 м²</p>
          {res.lines.length === 0 ? (
            <p className="text-[12px] text-[#9a9a95]">Пока нечего складывать.</p>
          ) : (
            <>
              {res.lines.map((l, i) => (
                <div key={i} className="flex justify-between gap-4 text-[12px]">
                  <span className="text-[#6b6b66]">{l.name} <span className="text-[#b0b0aa]">· {l.detail}</span></span>
                  <span className="font-mono text-[#111110] shrink-0">{rub(l.rubPerM2)} ₽</span>
                </div>
              ))}
              <div className="flex justify-between text-[12px] border-t border-[#e4e4e0] pt-1">
                <span className="text-[#111110] font-semibold">Прямые</span>
                <span className="font-mono text-[#111110] font-semibold">{rub(res.directPerM2)} ₽</span>
              </div>
              <div className="flex justify-between text-[12px]">
                <span className="text-[#6b6b66]">Накладные {ps.overhead_percent}%</span>
                <span className="font-mono text-[#6b6b66]">{rub(res.overheadPerM2)} ₽</span>
              </div>
              <div className="flex justify-between text-[14px] font-bold border-t border-[#111110] pt-1">
                <span>Себестоимость, ₽/м²</span>
                <span className="font-mono">{rub(res.costPerM2)} ₽</span>
              </div>
            </>
          )}
          {res.missing.length > 0 && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-[12px] font-semibold text-amber-800">Чтобы цифра была полной, не хватает:</p>
              {res.missing.map((m, i) => <p key={i} className="text-[12px] text-amber-800">— {m}</p>)}
            </div>
          )}
        </div>

        {res.missing.length === 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-2">
            <p className="text-[13px] font-semibold text-[#111110]">Что вписать в услугу</p>
            <p className="text-[12px] text-[#6b6b66]">
              В <Link href="/admin/b2b-services" className="underline underline-offset-2 text-[#111110]">Услугах B2B</Link> у строки пескоструя три поля — система сама сложит их и добавит накладные:
            </p>
            <div className="flex justify-between text-[12px]"><span className="text-[#6b6b66]">Время, мин</span><span className="font-mono">{rub(num(minutes))}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#6b6b66]">Расходники (плёнка + песок), ₽</span><span className="font-mono">{rub(Math.round(consumables * 100) / 100)}</span></div>
            <div className="flex justify-between text-[12px]"><span className="text-[#6b6b66]">Амортизация оборудования, ₽</span><span className="font-mono">{rub(Math.round(equipment * 100) / 100)}</span></div>
            <p className="text-[11px] text-[#9a9a95]">Работу оператора отдельно вписывать не нужно: её система посчитает из минут по своей ставке.</p>
          </div>
        )}

        {svcs.length > 0 && (
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-2">
            <p className="text-[13px] font-semibold text-[#111110]">Что стоит в справочнике сейчас</p>
            {svcs.map(s => (
              <div key={s.id} className="flex justify-between gap-4 text-[12px]">
                <span className="text-[#6b6b66]">{s.name}{s.active === false && <span className="text-[#b0b0aa]"> · отключена</span>}</span>
                <span className="font-mono text-[#111110] shrink-0">
                  {Number(s.cost_price ?? 0).toLocaleString('ru-RU')} ₽
                  <span className="text-[#b0b0aa]"> · продажа {Number(s.value ?? 0).toLocaleString('ru-RU')} {s.unit_label ?? ''}</span>
                </span>
              </div>
            ))}
            <p className="text-[11px] text-[#9a9a95]">
              Время, амортизация и расходники у этих строк — нули: значит себестоимость вписана руками и ни на что не раскладывается.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
