// Переиспользуемые UI-компоненты в едином стиле

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-[#e4e4e0] rounded-xl ${className}`}>
      {children}
    </div>
  )
}

export function CardHeader({ title }: { title: string }) {
  return (
    <div className="px-5 pt-5 pb-3 border-b border-[#f0f0ec]">
      <h2 className="text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest">{title}</h2>
    </div>
  )
}

export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-5 ${className}`}>{children}</div>
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold text-[#8a8a85] uppercase tracking-widest mb-1.5">
      {children}
    </label>
  )
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] placeholder-[#c4c4be] outline-none focus:border-[#111110] focus:bg-white transition-all ${props.className ?? ''}`}
    />
  )
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] text-[#111110] outline-none focus:border-[#111110] focus:bg-white transition-all ${props.className ?? ''}`}
    />
  )
}

export function Btn({
  children, variant = 'primary', size = 'md', disabled, onClick, type = 'button', className = '',
}: {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  onClick?: () => void
  type?: 'button' | 'submit'
  className?: string
}) {
  const base = 'inline-flex items-center justify-center font-medium transition-colors rounded-lg disabled:opacity-40'
  const sizes = { sm: 'text-[12px] px-3 py-1.5', md: 'text-[13px] px-4 py-2' }
  const variants = {
    primary:   'bg-[#111110] text-white hover:bg-[#2a2a28]',
    secondary: 'bg-[#f0f0ec] text-[#111110] hover:bg-[#e8e8e4]',
    ghost:     'text-[#6b6b66] hover:text-[#111110] hover:bg-[#f0f0ec]',
    danger:    'text-red-600 hover:bg-red-50',
  }
  return (
    <button type={type} disabled={disabled} onClick={onClick}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ label, color = 'gray' }: { label: string; color?: 'gray' | 'blue' | 'orange' | 'green' | 'red' | 'yellow' }) {
  const colors = {
    gray:   'bg-[#f0f0ec] text-[#6b6b66]',
    blue:   'bg-blue-50 text-blue-700',
    orange: 'bg-orange-50 text-orange-700',
    green:  'bg-emerald-50 text-emerald-700',
    red:    'bg-red-50 text-red-600',
    yellow: 'bg-yellow-50 text-yellow-700',
  }
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-md uppercase tracking-wide ${colors[color]}`}>
      {label}
    </span>
  )
}

export function Divider() {
  return <div className="border-t border-[#f0f0ec]" />
}

export function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between items-center py-1.5 ${bold ? 'border-t border-[#e4e4e0] mt-1 pt-3' : ''}`}>
      <span className={`text-[13px] ${bold ? 'font-semibold text-[#111110]' : 'text-[#6b6b66]'}`}>{label}</span>
      <span className={`text-[13px] font-mono ${bold ? 'font-bold text-[#111110]' : 'text-[#111110]'}`}>{value}</span>
    </div>
  )
}

export function MarginIndicator({ margin, minMargin }: { margin: number; minMargin: number }) {
  const isGood = margin >= 35
  const isOk   = margin >= minMargin
  return (
    <div className={`rounded-xl border p-5 ${isGood ? 'bg-emerald-50 border-emerald-200' : isOk ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
      {!isOk && (
        <div className="flex items-center gap-2 mb-3 pb-3 border-b border-red-200">
          <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <p className="text-[13px] font-semibold text-red-700">Маржа ниже минимума ({minMargin}%) — нужен апрув</p>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold text-[#111110]">Цена клиенту</span>
      </div>
    </div>
  )
}
