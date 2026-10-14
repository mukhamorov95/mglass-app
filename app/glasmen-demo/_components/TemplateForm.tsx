'use client'

import { TEMPLATES, type TemplateId, type TemplateParam, type TemplateParams } from '@/lib/glasmen'
import { num } from './api'
import NumField from './NumField'

export const isParamVisible = (p: TemplateParam, values: TemplateParams) => {
  if (!p.visibleIf) return true
  const v = values[p.visibleIf.key]
  if (p.visibleIf.atLeast !== undefined) return v >= p.visibleIf.atLeast
  if (p.visibleIf.equals !== undefined) return v === p.visibleIf.equals
  return true
}

export function TemplatePicker({ value, onPick }: { value: TemplateId; onPick: (id: TemplateId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {TEMPLATES.map(t => (
        <button
          key={t.id}
          type="button"
          onClick={() => onPick(t.id)}
          title={t.description}
          className={`rounded-xl border p-2.5 text-left transition ${value === t.id ? 'border-[#111110] bg-[#f5f5f3]' : 'border-[#e4e4e0] bg-white hover:border-[#9a9a95]'}`}
        >
          <div className="text-[13px] font-medium leading-tight">{t.title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[#9a9a95]">{t.description}</div>
        </button>
      ))}
    </div>
  )
}

export function TemplateParamsForm({ params, values, onChange }: { params: TemplateParam[]; values: TemplateParams; onChange: (key: string, v: number) => void }) {
  return (
    <div className="space-y-3">
      {params.filter(p => isParamVisible(p, values)).map(p => {
        const v = values[p.key] ?? p.default
        const id = `tp-${p.key}`
        if (p.options) {
          return (
            <label key={p.key} htmlFor={id} className="block">
              <span className="text-[12px] text-[#55554f]">{p.label}</span>
              <select
                id={id}
                value={v}
                onChange={e => onChange(p.key, Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-[#e4e4e0] bg-white px-2.5 py-2 text-[13px]"
              >
                {p.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )
        }
        return (
          <div key={p.key}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-[12px] text-[#55554f]">{p.label}</label>
              <span className="shrink-0 text-[11px] text-[#9a9a95]">{num(p.min)}–{num(p.max)}{p.unit ? ` ${p.unit}` : ''}</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range" min={p.min} max={p.max} step={p.step} value={Math.min(p.max, Math.max(p.min, v))}
                onChange={e => onChange(p.key, Number(e.target.value))}
                className="min-w-0 flex-1 accent-[#111110]"
                aria-label={p.label}
              />
              <NumField id={id} value={v} onChange={n => onChange(p.key, n)} className="w-24 shrink-0" />
            </div>
          </div>
        )
      })}
    </div>
  )
}
