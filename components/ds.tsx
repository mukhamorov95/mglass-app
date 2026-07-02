// Дизайн-система M-Glass (Вариант 3 — «карточки-строки»).
// Единая библиотека примитивов: меняем здесь — меняется во всех разделах.
// Палитра берётся из токенов globals.css (text-ink, bg-surface, border-line, ...).
// Компоненты презентационные (без хуков) — работают и в server-, и в client-страницах.

import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes } from 'react'

// ─── Иконки: inline-SVG (Lucide-стиль), без зависимостей и без веса ──────────
const ic = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
type IcP = { className?: string }
export const IcChevron   = ({ className = '' }: IcP) => <svg {...ic} className={className}><path d="m9 18 6-6-6-6" /></svg>
export const IcArrowLeft = ({ className = '' }: IcP) => <svg {...ic} className={className}><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></svg>
export const IcDownload  = ({ className = '' }: IcP) => <svg {...ic} className={className}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
export const IcX         = ({ className = '' }: IcP) => <svg {...ic} className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
export const IcArchive   = ({ className = '' }: IcP) => <svg {...ic} className={className}><rect width="20" height="5" x="2" y="3" rx="1" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>
export const IcSearch    = ({ className = '' }: IcP) => <svg {...ic} className={className}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>

// ─── PageHeader: заголовок страницы + подпись + действия справа ──────────────
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold text-ink tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── SegmentedTabs: сегмент-контрол (Архив / Корзина и т.п.) ─────────────────
export function SegmentedTabs<T extends string>({ tabs, value, onChange }: { tabs: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 bg-subtle border border-line rounded-xl p-1">
      {tabs.map(t => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`text-[13px] font-medium px-3.5 py-1.5 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/15 ${value === t.value ? 'bg-surface text-ink' : 'text-ink-soft hover:text-ink'}`}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ─── Field: текстовое поле с опциональной иконкой ────────────────────────────
export function Field({ icon, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode }) {
  return (
    <div className={`relative inline-flex items-center ${className}`}>
      {icon && <span className="absolute left-2.5 text-muted pointer-events-none">{icon}</span>}
      <input {...props}
        className={`w-full bg-surface border border-line rounded-lg py-1.5 text-[13px] text-ink placeholder-faint outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-all ${icon ? 'pl-8 pr-3' : 'px-3'}`} />
    </div>
  )
}

// ─── SelectField: выпадающий список ──────────────────────────────────────────
export function SelectField({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props}
      className={`bg-surface border border-line rounded-lg px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-all ${className}`}>
      {children}
    </select>
  )
}

// ─── SectionHeader: шапка группы (месяц/раздел), опц. сворачивание ───────────
export function SectionHeader({ title, meta, open, onToggle, actions }: { title: string; meta?: string; open?: boolean; onToggle?: () => void; actions?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left rounded outline-none focus-visible:ring-2 focus-visible:ring-ink/15">
        {onToggle && <IcChevron className={`w-4 h-4 text-muted flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />}
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {meta && <span className="text-[12px] text-muted">{meta}</span>}
      </button>
      {actions && <div className="flex items-center gap-1.5 flex-shrink-0">{actions}</div>}
    </div>
  )
}

// ─── StatusPill: статус в виде пилюли с семантическим тоном ───────────────────
const PILL_TONE = {
  neutral: 'bg-line-soft text-ink-soft',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  accent:  'bg-blue-50 text-blue-700',
  danger:  'bg-red-50 text-red-700',
  strong:  'bg-emerald-100 text-emerald-800',
} as const
export type PillTone = keyof typeof PILL_TONE
export function StatusPill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium ${PILL_TONE[tone]}`}>{children}</span>
}

// ─── IconButton: компактная иконка-действие ──────────────────────────────────
export function IconButton({ title, onClick, tone = 'default', children, href, download, target }: {
  title: string; onClick?: () => void; tone?: 'default' | 'danger' | 'accent'; children: ReactNode; href?: string; download?: boolean; target?: string
}) {
  const tones = {
    default: 'text-muted hover:text-ink hover:bg-subtle',
    danger:  'text-muted hover:text-red-500 hover:bg-red-50',
    accent:  'text-muted hover:text-violet-600 hover:bg-violet-50',
  }
  const cls = `inline-flex items-center justify-center p-1.5 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink/15 ${tones[tone]}`
  if (href) return <a href={href} title={title} download={download} target={target} className={cls}>{children}</a>
  return <button type="button" title={title} onClick={onClick} className={cls}>{children}</button>
}

// ─── RowCard: карточка-строка — ядро Варианта 3 ──────────────────────────────
export function RowCard({ leading, title, subtitle, pill, amount, amountSub, actions, selected, onClick }: {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; pill?: ReactNode
  amount?: ReactNode; amountSub?: ReactNode; actions?: ReactNode; selected?: boolean; onClick?: () => void
}) {
  return (
    <div onClick={onClick}
      className={`flex items-center gap-3 sm:gap-4 bg-surface border rounded-xl px-4 py-3 transition-colors ${selected ? 'border-ink/30 bg-subtle' : 'border-line'} ${onClick ? 'cursor-pointer hover:bg-subtle' : ''}`}>
      {leading && <div className="flex-shrink-0">{leading}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-[14px] text-ink truncate">{title}</div>
        {subtitle && <div className="text-[12px] text-muted mt-0.5 truncate">{subtitle}</div>}
      </div>
      {pill && <div className="flex-shrink-0">{pill}</div>}
      {amount != null && (
        <div className="flex-shrink-0 text-right">
          <div className="font-mono text-[15px] font-semibold text-ink whitespace-nowrap tabular-nums">{amount}</div>
          {amountSub && <div className="text-[11px] mt-0.5">{amountSub}</div>}
        </div>
      )}
      {actions && <div className="flex-shrink-0 flex items-center gap-0.5">{actions}</div>}
    </div>
  )
}

// ─── MetricTile: бенто-плитка со сводным числом (опционально) ────────────────
export function MetricTile({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-subtle rounded-xl px-4 py-3">
      <div className="text-[12px] text-muted">{label}</div>
      <div className="text-[22px] font-semibold text-ink mt-0.5 tabular-nums">{value}</div>
      {hint && <div className="text-[11px] text-muted mt-0.5">{hint}</div>}
    </div>
  )
}

// ─── EmptyState: пустое состояние (иконка + подсказка + действие) ────────────
export function EmptyState({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      {icon && <div className="text-faint mb-3">{icon}</div>}
      <p className="text-[13px] font-medium text-ink-soft">{title}</p>
      {hint && <p className="text-[12px] text-muted mt-1">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

// ─── SkeletonRows: заглушки строк на время загрузки ──────────────────────────
export function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 bg-surface border border-line rounded-xl px-4 py-3">
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-40 rounded bg-[#e6e6e2] animate-pulse" />
            <div className="h-3 w-24 rounded bg-line-soft animate-pulse" />
          </div>
          <div className="h-4 w-20 rounded bg-line-soft animate-pulse" />
        </div>
      ))}
    </div>
  )
}
