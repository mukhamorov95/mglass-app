'use client'

// Переключатель обработки в просчёте.
//
// Раньше каждый был парой «серая подпись сверху + галка с текстом снизу», и они
// спорили: подпись «Криволинейка», а в галке «Прямой рез»; подпись «Фацет» — в
// галке «Без фацета». Читать приходилось дважды, чтобы понять, включено или нет.
// Теперь переключатель один: он и называет обработку, и показывает состояние
// цветом. Высота 44 px — просчёты делают и с телефона.
export function TreatToggle({ on, onChange, label, tone }: {
  on: boolean; onChange: (v: boolean) => void; label: string
  tone: 'orange' | 'purple' | 'blue' | 'teal' | 'violet' | 'indigo'
}) {
  const TONES: Record<string, string> = {
    orange: 'border-orange-300 bg-orange-50 text-orange-700',
    purple: 'border-purple-300 bg-purple-50 text-purple-700',
    blue:   'border-blue-300 bg-blue-50 text-blue-700',
    teal:   'border-teal-300 bg-teal-50 text-teal-700',
    violet: 'border-violet-300 bg-violet-50 text-violet-700',
    indigo: 'border-indigo-300 bg-indigo-50 text-indigo-700',
  }
  return (
    <label className={`flex items-center gap-2 min-h-[44px] px-2.5 py-1.5 border rounded-lg cursor-pointer transition-all ${
      on ? TONES[tone] : 'border-[#e4e4e0] bg-white text-[#6b6b66] hover:border-[#c4c4be]'}`}>
      <input type="checkbox" checked={on} onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded accent-[#111110] flex-shrink-0" />
      {/* min-w-0 обязателен: без него флекс-элемент не сжимается и длинное слово
          («Криволинейка») обрезается вместо переноса. */}
      <span className={`text-[13px] leading-tight min-w-0 ${on ? 'font-semibold' : 'font-medium'}`}>{label}</span>
    </label>
  )
}

