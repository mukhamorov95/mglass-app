'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { SHOWER_MODELS, type ShowerModelId } from '@/lib/showerCalculator'
import { configuratorCode } from '@/lib/configurator/legacyModelMap'
import { getModel } from '@/lib/configurator/arrangement'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

// Вкладка «Расчёт»: модель душевой → габариты проёма → реальный BOM фурнитуры и
// стекло → себестоимость → цена. Фурнитура и количества считаются ЕДИНЫМ движком
// конфигуратора (buildFromModel→computeKitQuantities→computeKitPrice) через готовый
// серверный маршрут /api/configurator/quote — здесь только вызов, не дубль арифметики.
// Себестоимость берём из BOM, а маржу/налог/монтаж/доставку — свои, редактируемые
// в правой панели (числа владельца), поэтому цену из computeKitPrice не используем.

type KitLine = { role: string; label: string; qty: number; unit: string; unitPrice: number; total: number }
type Price = {
  glassCost: number; hardwareCost: number; sections: number
  lines: KitLine[]; missing: { label: string; reason: string }[]; complete: boolean; belowMin: boolean
}

const RUB = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }

const fld = 'w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] font-mono text-[#111110] outline-none focus:border-[#111110] transition-all'
const lbl = 'block text-[11px] font-medium text-[#6e6e73] mb-1'

// Модели, для которых заведён фотореалистичный рендер в /public/models/<код>.jpg
// (снимки настоящего 3D-визуализатора). Остальным — схема, БЕЗ попытки загрузить
// картинку (иначе браузер рисует «битое фото»). Добавили новый файл — впиши код сюда.
const PHOTO_MODELS = new Set<string>(['M1', 'M2', 'M4', 'M7', 'M8', 'M9', 'M10', 'M12'])
function ModelThumb({ id }: { id: ShowerModelId }) {
  if (PHOTO_MODELS.has(id)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/models/${id.toLowerCase()}.jpg`} alt="" className="w-full h-full object-cover" />
  }
  // Фото ещё нет — аккуратная нейтральная заглушка (не грубая схема), пока рендер не заведён.
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[#c4c4be]">
      <span className="text-[22px]">🚿</span>
      <span className="text-[10px]">фото скоро</span>
    </div>
  )
}

export default function BuildCalcPage() {
  const router = useRouter()
  const [modelId, setModelId] = useState<ShowerModelId>('M2')
  const [width, setWidth]   = useState('1100')
  const [width2, setWidth2] = useState('900')
  const [height, setHeight] = useState('2000')
  const [hwColor] = useState('chrome')

  // Клиент — опционально: расчёт сохранится и без него, но с телефоном/адресом
  // попадёт в сделку (иначе он выпадает из контура сделок совсем).
  const [clientName, setClientName] = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [objectAddress, setObjectAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const lastSavedSigRef = useRef('')
  const parentCalcIdRef = useRef<number | null>(null)
  const reopenDealIdRef = useRef<number | null>(null)

  const [price, setPrice] = useState<Price | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'no-kit'>('idle')

  // Правая панель — числа владельца, не из конфигуратора. Маржа/налог/монтаж/доставка
  // редактируемы; на смене модели секции подставляются из BOM (sections по модели).
  const [margin, setMargin] = useState('40')
  const [tax, setTax] = useState('12')
  const [perSection, setPerSection] = useState('6500')
  const [sections, setSections] = useState('1')
  const [delivery, setDelivery] = useState('5000')
  const [lift, setLift] = useState('')

  const model = SHOWER_MODELS.find(m => m.id === modelId) ?? SHOWER_MODELS[0]
  const isCorner = model.dimType === 'corner'
  const cyr = configuratorCode(modelId)

  // Диапазоны проёма из конфигуратора (та же геометрия, что считает цену).
  const constraints = useMemo(() => (cyr ? getModel(cyr).constraints : null), [cyr])

  useEffect(() => {
    const w = numOr(width), h = numOr(height), w2 = numOr(width2)
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      if (!cyr) { setPrice(null); setState('no-kit'); return }
      if (w <= 0 || h <= 0) { setPrice(null); setState('idle'); return }
      setState('loading')
      // dims — размеры ПРОЁМА (не стёкол): стёкла из него считает геометрия, лёгкий
      // запас осознан (владелец). thickness 8 по умолчанию.
      fetch('/api/configurator/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({
          model: cyr, tier: 'budget', thickness: 8, finishId: hwColor,
          dims: { width: w, height: h, ...(isCorner && w2 > 0 ? { width2: w2 } : {}) },
        }),
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then((res: { full?: boolean; price?: Price }) => {
          if (res.full && res.price) {
            setPrice(res.price)
            setSections(String(res.price.sections || 1))
            setState('idle')
          } else { setPrice(null); setState('error') }
        })
        .catch((e: unknown) => { if ((e as Error)?.name !== 'AbortError') { setPrice(null); setState('error') } })
    }, 350)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [cyr, isCorner, width, width2, height, hwColor])

  // Себестоимость = стекло + фурнитура из BOM. Стекло пока по флэт-ставке конфигуратора;
  // на шаге 2 заменится точным b2bCalculator через glassCostOverride.
  const glassCost = price?.glassCost ?? 0
  const hwCost = price?.hardwareCost ?? 0
  const usable = !!price && price.complete
  const cost = glassCost + hwCost
  const m = numOr(margin), tx = numOr(tax)
  const denom = 1 - m / 100 - tx / 100
  const fin = calcFinancialModel({ directCost: cost, marginPercent: m, taxPercent: tx })
  const productPrice = fin ? fin.basePrice : 0
  const install = numOr(perSection) * numOr(sections)
  const grand = Math.round((usable ? productPrice : 0) + install + numOr(delivery) + numOr(lift))

  // Переоткрытие сохранённого расчёта «Расчёт» (из истории/карточки): снимок из
  // sessionStorage, восстанавливаем модель, габариты и параметры панели.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mglass_build_reopen')
      if (!raw) return
      sessionStorage.removeItem('mglass_build_reopen')
      const p = JSON.parse(raw) as Record<string, unknown>
      const s = (k: string) => (p[k] != null ? String(p[k]) : undefined)
      const set = (v: string | undefined, f: (x: string) => void) => { if (v != null) f(v) }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (p.modelId) setModelId(p.modelId as ShowerModelId)
      set(s('width'), setWidth); set(s('width2'), setWidth2); set(s('height'), setHeight)
      set(s('margin'), setMargin); set(s('tax'), setTax)
      set(s('perSection'), setPerSection); set(s('delivery'), setDelivery); set(s('lift'), setLift)
      set(s('clientName'), setClientName); set(s('clientPhone'), setClientPhone); set(s('objectAddress'), setObjectAddress)
      if (typeof p.__parentCalcId === 'number') parentCalcIdRef.current = p.__parentCalcId
      if (typeof p.__dealId === 'number') reopenDealIdRef.current = p.__dealId
    } catch { /* ignore */ }
  }, [])

  const productTitle = () => `${model.label} · ${isCorner ? `${numOr(width)}×${numOr(width2)}×${numOr(height)}` : `${numOr(width)}×${numOr(height)}`} мм`

  // Сохранение в историю (product_type='build'). Как в быстром расчёте: снимок входных
  // данных + итог; с телефоном/адресом расчёт заводит/находит сделку (ensure).
  async function persistBuild({ silent }: { silent: boolean }): Promise<boolean> {
    if (!usable || grand <= 0) { if (!silent) { setSaveMsg('Нечего сохранять — проверьте комплект'); setTimeout(() => setSaveMsg(null), 2500) } return false }
    const snapshot = { modelId, width, width2, height, hwColor, margin, tax, perSection, sections, delivery, lift, clientName, clientPhone, objectAddress, glassCost, hwCost }
    const sig = JSON.stringify(snapshot) + '|' + grand
    if (sig === lastSavedSigRef.current) { if (!silent) { setSaveMsg('Уже сохранено ✓'); setTimeout(() => setSaveMsg(null), 2500) } return true }
    if (!silent) { setSaving(true); setSaveMsg(null) }
    try {
      const { saveCalculation } = await import('@/lib/saveCalculation')
      const res = await saveCalculation({
        product_type: 'build',
        input_data: snapshot,
        cost_breakdown: { glassCost, hwCost, directCost: cost, productPrice, installTotal: install, delivery: numOr(delivery), lift: numOr(lift), sections: numOr(sections) },
        financial_breakdown: { marginPct: m, taxPct: tx, perSection: numOr(perSection), grand },
        base_price: grand,
        discount: 0,
        partner_percent: 0,
        final_price: grand,
        margin: m,
        profit: Math.max(0, Math.round(grand - cost)),
        client_text: [productTitle(), objectAddress && `Адрес: ${objectAddress}`].filter(Boolean).join(' · '),
        client_name: clientName.trim() || undefined,
        client_phone: clientPhone.trim() || undefined,
        parent_calc_id: parentCalcIdRef.current ?? undefined,
      })
      const ok = !!(res && 'id' in res && res.id)
      if (!ok) { if (!silent) setSaveMsg(res && 'error' in res ? res.error! : 'Не удалось сохранить'); return false }
      lastSavedSigRef.current = sig
      const newId = (res as { id: number }).id
      let createdDeal = false
      if (reopenDealIdRef.current) {
        try { await fetch(`/api/deals/${reopenDealIdRef.current}/attach`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: newId }) }) } catch { /* привяжется вручную */ }
      } else if (clientPhone.trim() || objectAddress.trim()) {
        try {
          const er = await fetch('/api/deals/ensure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ calc_id: newId, client_name: clientName.trim(), phone: clientPhone.trim(), address: objectAddress.trim() }) }).then(x => x.json()).catch(() => null)
          createdDeal = !!er?.created
        } catch { /* заведём вручную */ }
      }
      if (!silent) setSaveMsg(createdDeal ? 'Сохранено, заведена сделка ✓' : 'Сохранено в историю расчётов ✓')
      return true
    } finally {
      if (!silent) { setSaving(false); setTimeout(() => setSaveMsg(null), 4000) }
    }
  }

  // «Сформировать КП»: авто-сохранение + префилл /kp одной позицией изделия.
  async function toKp() {
    if (!usable || grand <= 0) return
    await persistBuild({ silent: true })
    const items: { name: string; qty?: number; price?: number; sum: number }[] = [
      { name: productTitle(), qty: 1, price: Math.round(productPrice), sum: Math.round(productPrice) },
    ]
    if (install > 0) items.push({ name: 'Монтаж', qty: numOr(sections) || 1, price: numOr(perSection), sum: Math.round(install) })
    if (numOr(delivery) > 0) items.push({ name: 'Доставка', qty: 1, sum: numOr(delivery) })
    if (numOr(lift) > 0) items.push({ name: 'Подъём', qty: 1, sum: numOr(lift) })
    const content = { title: productTitle().toUpperCase(), items, subtotal: grand, total: grand }
    try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch { /* ignore */ }
    router.push('/kp')
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-[#111110]">Расчёт</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Модель → габариты проёма → себестоимость (реальный комплект) → цена. Стекло и фурнитура считаются тем же движком, что и на сайте.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="space-y-4">
            {/* Модель */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <label className={lbl}>Модель</label>
              {/* Только реальный ряд: модели с заведённым комплектом (configuratorCode).
                  М3/М5/М6 «без кита» не считаются — в пикере их не показываем. */}
              <div className="grid grid-cols-3 gap-1.5">
                {SHOWER_MODELS.filter(mm => configuratorCode(mm.id)).map(mm => {
                  const active = modelId === mm.id
                  return (
                    <button key={mm.id} onClick={() => setModelId(mm.id)}
                      className={`flex flex-col items-stretch p-2 rounded-xl border text-left transition-all ${active ? 'border-[#111110] bg-[#f0f0ec]' : 'border-[#e4e4e0] hover:border-[#c7c7cc]'}`}>
                      <div className={`rounded-lg mb-1.5 overflow-hidden flex items-center justify-center h-[170px] ${active ? 'bg-white' : 'bg-[#f5f5f7]'}`}>
                        <ModelThumb id={mm.id} />
                      </div>
                      <span className={`text-[12px] font-bold ${active ? 'text-[#111110]' : 'text-[#1d1d1f]'}`}>{mm.label}</span>
                      <span className="text-[9px] text-[#86868b] leading-tight">{mm.desc}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Габариты проёма */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              {/* «Проём», не «стекло»: геометрия сама считает стёкла, лёгкий запас осознан. */}
              <label className={lbl}>Размеры проёма, мм{constraints ? ` · Ш ${constraints.width[0]}–${constraints.width[1]}, В ${constraints.height[0]}–${constraints.height[1]}` : ''}</label>
              <div className={`grid gap-3 ${isCorner ? 'grid-cols-3' : 'grid-cols-2'}`}>
                <div><span className="text-[11px] text-[#9a9a95]">{isCorner ? 'Ширина 1' : 'Ширина'}</span>
                  <input type="number" className={fld} value={width} onChange={e => setWidth(e.target.value)} /></div>
                {isCorner && (
                  <div><span className="text-[11px] text-[#9a9a95]">Ширина 2</span>
                    <input type="number" className={fld} value={width2} onChange={e => setWidth2(e.target.value)} /></div>
                )}
                <div><span className="text-[11px] text-[#9a9a95]">Высота</span>
                  <input type="number" className={fld} value={height} onChange={e => setHeight(e.target.value)} /></div>
              </div>
            </div>

            {/* Себестоимость и состав */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-semibold text-[#111110]">Себестоимость</h3>
                {state === 'loading' && <span className="text-[11px] text-[#9a9a95]">считаю…</span>}
              </div>

              {state === 'no-kit' ? (
                <p className="text-[12px] text-[#c2410c]">Комплект этой модели не заведён в конфигураторе — расчёт недоступен.</p>
              ) : state === 'error' ? (
                <p className="text-[12px] text-[#9a9a95]">Не удалось посчитать. Проверьте размеры и связь.</p>
              ) : price ? (
                <>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-[#6b6b66]">Стекло</span><span className="font-mono">{RUB(glassCost)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px]">
                    <span className="text-[#6b6b66]">Фурнитура (комплект)</span><span className="font-mono">{RUB(hwCost)}</span>
                  </div>
                  {price.missing.length > 0 && (
                    <p className="text-[12px] text-[#c2410c]">
                      Цена не заведена: {price.missing.map(x => `${x.label} (${x.reason})`).join(', ')}. Итог занижен — сообщите, чтобы завели позиции.
                    </p>
                  )}
                  <div className="h-px bg-[#f0f0ec]" />
                  <div className="flex items-center justify-between text-[13px] font-semibold">
                    <span className="text-[#111110]">Итого себестоимость</span><span className="font-mono">{RUB(cost)}</span>
                  </div>
                  <p className="text-[11px] text-[#9a9a95]">Секций по модели: {price.sections}</p>

                  {price.lines.length > 0 && (
                    <details className="mt-1">
                      <summary className="text-[11px] text-[#6b6b66] cursor-pointer">Состав комплекта ({price.lines.length})</summary>
                      <div className="mt-1 space-y-0.5">
                        {price.lines.map((l, i) => (
                          <div key={i} className="flex items-center justify-between text-[11px] text-[#6b6b66]">
                            <span>{l.label} · {l.qty} {l.unit}</span><span className="font-mono">{RUB(l.total)}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              ) : (
                <p className="text-[12px] text-[#9a9a95]">Введите размеры проёма.</p>
              )}
            </div>
          </div>

          {/* Правая панель — цена клиенту */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 space-y-3 md:sticky md:top-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#111110]">Цена клиенту</h3>
              <span className="text-[11px] text-[#9a9a95]">маржа/налог → 40/12 на новом просчёте</span>
            </div>

            <div className="flex items-center justify-between text-[13px]">
              <span className="text-[#6b6b66]">Себестоимость <span className="text-[#9a9a95]">(стекло + фурнитура)</span></span>
              <span className="font-mono font-semibold">{RUB(cost)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Маржа, %</label>
                <input type="number" className={fld} value={margin} onChange={e => setMargin(e.target.value)} /></div>
              <div><label className={lbl}>Налог, %</label>
                <input type="number" className={fld} value={tax} onChange={e => setTax(e.target.value)} /></div>
            </div>

            {denom <= 0 ? (
              <p className="text-[12px] text-red-600">Маржа + налог ≥ 100% — цена не считается.</p>
            ) : (
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[#6b6b66]">Цена изделия <span className="text-[#9a9a95]">= себест ÷ (1 − {m}% − {tx}%)</span></span>
                <span className="font-mono font-semibold">{RUB(productPrice)}</span>
              </div>
            )}

            <div className="h-px bg-[#f0f0ec]" />
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Монтаж за секцию, ₽</label>
                <input type="number" className={fld} value={perSection} onChange={e => setPerSection(e.target.value)} /></div>
              <div><label className={lbl}>Секций <span className="text-[#9a9a95]">(по модели)</span></label>
                <input type="number" className={fld} value={sections} onChange={e => setSections(e.target.value)} /></div>
              <div><label className={lbl}>Доставка, ₽</label>
                <input type="number" className={fld} value={delivery} onChange={e => setDelivery(e.target.value)} /></div>
              <div><label className={lbl}>Подъём, ₽</label>
                <input type="number" className={fld} value={lift} onChange={e => setLift(e.target.value)} placeholder="0" /></div>
            </div>
            {/* Каждое слагаемое итога — видимой строкой (иначе итог «не сходится» на глаз). */}
            {usable && productPrice > 0 && (
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66]">
                <span>Изделие</span><span className="font-mono">{RUB(productPrice)}</span>
              </div>
            )}
            {install > 0 && (
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66]">
                <span>Монтаж ({numOr(sections)} × {RUB(numOr(perSection))})</span><span className="font-mono">{RUB(install)}</span>
              </div>
            )}
            {numOr(delivery) > 0 && (
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66]">
                <span>Доставка</span><span className="font-mono">{RUB(numOr(delivery))}</span>
              </div>
            )}
            {numOr(lift) > 0 && (
              <div className="flex items-center justify-between text-[12px] text-[#6b6b66]">
                <span>Подъём</span><span className="font-mono">{RUB(numOr(lift))}</span>
              </div>
            )}

            <div className="h-px bg-[#f0f0ec]" />
            <div className="flex items-center justify-between">
              <span className="text-[14px] font-semibold text-[#111110]">К оплате</span>
              <span className="text-[22px] font-bold font-mono text-[#111110]">{RUB(grand)}</span>
            </div>
            {price && !usable && price.missing.length > 0 && (
              <p className="text-[11px] text-[#c2410c]">Цена изделия скрыта: в комплекте не заведены позиции (см. слева).</p>
            )}

            {/* Клиент (опц.) + действия: сохранить и КП — чтобы результат не пропадал. */}
            <div className="h-px bg-[#f0f0ec]" />
            <div className="grid grid-cols-1 gap-1.5">
              <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Клиент (необязательно)"
                className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
              <div className="grid grid-cols-2 gap-1.5">
                <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Телефон" inputMode="tel"
                  className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                <input value={objectAddress} onChange={e => setObjectAddress(e.target.value)} placeholder="Адрес объекта"
                  className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => persistBuild({ silent: false })} disabled={!usable || grand <= 0 || saving}
                className="px-4 py-2.5 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-50">
                {saving ? 'Сохраняю…' : '💾 Сохранить'}
              </button>
              <button onClick={toKp} disabled={!usable || grand <= 0}
                className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50">
                Сформировать КП →
              </button>
            </div>
            {saveMsg && (
              <p className={`text-center text-[13px] font-semibold rounded-lg px-3 py-2 ${saveMsg.includes('✓') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                {saveMsg}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
