'use client'

import { PARAM_LIMITS } from '@/lib/glasmen/priceParams'
import type { LadderTier, ModelId, ParamsOverride, PriceModelParams, QuoteModelResult } from './api'
import { num, rub } from './api'
import NumField from './NumField'

// Ползунок — удобный диапазон внутри PARAM_LIMITS; точное значение — полем (сервер зажмёт в PARAM_LIMITS и скажет об этом).
const UI = {
  S: { min: 0, max: Math.min(5000, PARAM_LIMITS.S.max), step: 50 },
  k: { min: Math.max(0.8, PARAM_LIMITS.k.min), max: Math.min(1.2, PARAM_LIMITS.k.max), step: 0.0005 },
  M: { min: 0, max: Math.min(20000, PARAM_LIMITS.M.max), step: 500 },
}

const LABEL: Record<keyof PriceModelParams, string> = {
  S: 'S — наладка, ₽ (с НДС, до скидки)',
  k: 'k — множитель прайса',
  M: 'M — минимальная сумма заказа, ₽ (после скидки)',
  ladder: 'Лесенка за серию одинаковых деталей',
  floorPerLine: 'Минимальная цена позиции — один раз на строку (иначе × шт., как сейчас)',
  ladderAppliesToTempering: 'Лесенка действует и на закалку',
}

export default function ParamsDrawer({
  model, result, override, onChange, onReset,
}: {
  model: ModelId
  result: QuoteModelResult
  override: ParamsOverride | undefined
  onChange: (patch: ParamsOverride) => void
  onReset: () => void
}) {
  const used = result.paramsUsed
  const p = result.params                         // чем реально посчитано (после зажима на сервере)
  const e: PriceModelParams = { ...p, ...(override ?? {}) }   // что сейчас стоит в ручках
  if (!used.length) {
    return <p className="text-[12px] text-[#9a9a95]">У варианта «{result.title}» нет параметров — так считается сегодня.</p>
  }

  const slider = (key: 'S' | 'k' | 'M') => {
    const r = UI[key]
    const lim = PARAM_LIMITS[key]
    const v = e[key]
    return (
      <div key={key}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-[#55554f]">{LABEL[key]}</span>
          <span className="shrink-0 text-[11px] text-[#9a9a95]">допустимо {num(lim.min, 4)}–{num(lim.max, 4)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <input
            type="range" min={r.min} max={r.max} step={r.step}
            value={Math.min(r.max, Math.max(r.min, v))}
            onChange={ev => onChange({ [key]: Number(ev.target.value) })}
            className="min-w-0 flex-1 accent-[#111110]"
            aria-label={LABEL[key]}
          />
          <NumField value={v} onChange={n => onChange({ [key]: n })} className="w-28 shrink-0" ariaLabel={LABEL[key]} />
        </div>
        <div className="mt-0.5 text-[11px] text-[#9a9a95]">в расчёте: {key === 'k' ? num(p.k, 4) : rub(p[key])}</div>
      </div>
    )
  }

  const tiers = e.ladder
  const setTiers = (next: LadderTier[]) => onChange({ ladder: next })

  return (
    <div className="space-y-4">
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
        Черновик — подбор для решения 4. Значения по умолчанию — из калибровки варианта; меняются только в этом расчёте.
      </p>
      {(['S', 'k', 'M'] as const).filter(k => used.includes(k)).map(slider)}

      {used.includes('ladder') && (
        <div>
          <div className="text-[12px] text-[#55554f]">{LABEL.ladder}</div>
          <div className="mt-1 space-y-1.5">
            {tiers.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="text-[#9a9a95]">от</span>
                <NumField value={t.fromQty} onChange={n => setTiers(tiers.map((x, j) => (j === i ? { ...x, fromQty: Math.round(n) } : x)))} className="w-20" suffix="шт." ariaLabel={`Ступень ${i + 1}: от, шт.`} />
                <span className="text-[#9a9a95]">скидка</span>
                <NumField value={t.pct} onChange={n => setTiers(tiers.map((x, j) => (j === i ? { ...x, pct: n } : x)))} className="w-20" suffix="%" ariaLabel={`Ступень ${i + 1}: скидка, %`} />
                <button type="button" onClick={() => setTiers(tiers.filter((_, j) => j !== i))} className="ml-auto rounded px-1.5 text-[#9a9a95] hover:bg-[#f5f5f3] hover:text-red-700" aria-label={`Убрать ступень ${i + 1}`}>×</button>
              </div>
            ))}
            {tiers.length < PARAM_LIMITS.ladderTiers && (
              <button
                type="button"
                onClick={() => setTiers([...tiers, { fromQty: (tiers[tiers.length - 1]?.fromQty ?? 0) * 2 || 1, pct: tiers[tiers.length - 1]?.pct ?? 0 }])}
                className="text-[12px] underline underline-offset-2 hover:no-underline"
              >
                + ступень
              </button>
            )}
          </div>
        </div>
      )}

      {used.includes('floorPerLine') && (
        <label className="flex items-start gap-2 text-[12px] text-[#55554f]">
          <input type="checkbox" className="mt-0.5 accent-[#111110]" checked={e.floorPerLine} onChange={ev => onChange({ floorPerLine: ev.target.checked })} />
          {LABEL.floorPerLine}
        </label>
      )}
      {used.includes('ladderAppliesToTempering') && (
        // Сервер не передаёт долю закалки (temperingPart): без неё снятая галочка ничего бы не изменила.
        <label className="flex items-start gap-2 text-[12px] text-[#9a9a95]">
          <input type="checkbox" className="mt-0.5" checked disabled />
          <span>
            {LABEL.ladderAppliesToTempering}
            <span className="block">Отключить нельзя: нужен тариф подрядчика по закалке, его пока нет в справочнике.</span>
          </span>
        </label>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[#e4e4e0] pt-3">
        <span className="text-[11px] text-[#9a9a95]">{override && Object.keys(override).length ? 'Изменено вручную' : 'Как в варианте'} · {model}</span>
        <button type="button" onClick={onReset} disabled={!override || !Object.keys(override).length} className="rounded-lg px-2.5 py-1 text-[12px] text-[#55554f] hover:bg-[#f5f5f3] disabled:opacity-40">
          Сбросить к варианту
        </button>
      </div>
    </div>
  )
}
