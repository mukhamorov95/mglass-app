'use client'

import { useState } from 'react'

type ProductType = 'mirror' | 'loft' | 'shower' | 'other'

const PRODUCT_OPTIONS: { value: ProductType; label: string }[] = [
  { value: 'mirror',  label: 'Зеркало с подсветкой' },
  { value: 'loft',    label: 'Лофт-перегородка' },
  { value: 'shower',  label: 'Душевая перегородка' },
  { value: 'other',   label: 'Прочее' },
]

export default function MeasurerPage() {
  const [step, setStep] = useState<'form' | 'done'>('form')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [clientName, setClientName] = useState('')
  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [productType, setProductType] = useState<ProductType>('mirror')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [depth, setDepth] = useState('')
  const [notes, setNotes] = useState('')
  const [photos, setPhotos] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])

  function addPhoto(file: File) {
    setPhotos(prev => [...prev, file])
    const url = URL.createObjectURL(file)
    setPreviews(prev => [...prev, url])
  }

  function removePhoto(i: number) {
    setPhotos(prev => prev.filter((_, idx) => idx !== i))
    setPreviews(prev => prev.filter((_, idx) => idx !== i))
  }

  async function submit() {
    if (!clientName.trim()) { setError('Укажите имя клиента'); return }
    if (!address.trim())    { setError('Укажите адрес объекта'); return }
    setSaving(true)
    setError('')

    const form = new FormData()
    form.append('client_name',  clientName.trim())
    form.append('address',      address.trim())
    form.append('phone',        phone.trim())
    form.append('product_type', productType)
    form.append('dimensions',   JSON.stringify({ width, height, depth }))
    form.append('notes',        notes.trim())
    photos.forEach(f => form.append('photos', f))

    const res = await fetch('/api/measurer', { method: 'POST', body: form })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) { setError(data.error ?? 'Ошибка'); return }
    setStep('done')
  }

  if (step === 'done') {
    return (
      <div className="min-h-screen bg-[#f5f5f3] flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-8 text-center max-w-sm w-full">
          <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-[18px] font-bold text-[#111110] mb-2">Замер отправлен</h2>
          <p className="text-[14px] text-[#6b6b66] mb-6">Данные сохранены и переданы менеджеру</p>
          <button
            onClick={() => {
              setStep('form')
              setClientName(''); setAddress(''); setPhone('')
              setWidth(''); setHeight(''); setDepth(''); setNotes('')
              setPhotos([]); setPreviews([])
            }}
            className="w-full py-3 bg-[#111110] text-white rounded-xl text-[15px] font-semibold"
          >
            Новый замер
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-[#e4e4e0] px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 bg-[#111110] rounded-lg flex items-center justify-center">
          <span className="text-white text-[11px] font-bold">MG</span>
        </div>
        <div>
          <p className="text-[15px] font-bold text-[#111110]">Форма замера</p>
          <p className="text-[11px] text-[#9a9a95]">MGlass</p>
        </div>
      </div>

      <div className="px-4 py-5 space-y-4 pb-28">

        {/* Client block */}
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-4 space-y-3">
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider">Клиент</p>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b6b66] mb-1">Имя *</label>
            <input type="text" value={clientName} onChange={e => setClientName(e.target.value)}
              placeholder="Иванов Иван"
              className="w-full border border-[#e4e4e0] rounded-xl px-4 py-3 text-[15px] outline-none focus:border-[#0071e3]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b6b66] mb-1">Телефон</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="+7 (999) 000-00-00"
              className="w-full border border-[#e4e4e0] rounded-xl px-4 py-3 text-[15px] outline-none focus:border-[#0071e3]" />
          </div>
          <div>
            <label className="block text-[12px] font-semibold text-[#6b6b66] mb-1">Адрес объекта *</label>
            <input type="text" value={address} onChange={e => setAddress(e.target.value)}
              placeholder="ул. Примерная, д. 1, кв. 42"
              className="w-full border border-[#e4e4e0] rounded-xl px-4 py-3 text-[15px] outline-none focus:border-[#0071e3]" />
          </div>
        </div>

        {/* Product block */}
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-4 space-y-3">
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider">Изделие</p>
          <div className="grid grid-cols-2 gap-2">
            {PRODUCT_OPTIONS.map(opt => (
              <button key={opt.value}
                onClick={() => setProductType(opt.value)}
                className={`py-3 px-3 rounded-xl text-[13px] font-semibold border transition-colors text-left ${
                  productType === opt.value
                    ? 'bg-[#111110] text-white border-[#111110]'
                    : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#c4c4c0]'
                }`}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Dimensions block */}
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-4 space-y-3">
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider">Размеры (мм)</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Ширина', value: width, set: setWidth },
              { label: 'Высота', value: height, set: setHeight },
              { label: 'Глубина', value: depth, set: setDepth },
            ].map(({ label, value, set }) => (
              <div key={label}>
                <label className="block text-[11px] font-semibold text-[#9a9a95] mb-1">{label}</label>
                <input type="number" inputMode="numeric" value={value} onChange={e => set(e.target.value)}
                  placeholder="0"
                  className="w-full border border-[#e4e4e0] rounded-xl px-3 py-3 text-[15px] font-mono text-center outline-none focus:border-[#0071e3]" />
              </div>
            ))}
          </div>
        </div>

        {/* Photos */}
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-4">
          <p className="text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-3">Фото объекта</p>
          <div className="flex flex-wrap gap-2">
            {previews.map((url, i) => (
              <div key={i} className="relative">
                <img src={url} alt="" className="w-20 h-20 object-cover rounded-xl border border-[#e4e4e0]" />
                <button onClick={() => removePhoto(i)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full text-[12px] flex items-center justify-center">
                  ×
                </button>
              </div>
            ))}
            <label className="w-20 h-20 flex flex-col items-center justify-center border-2 border-dashed border-[#e4e4e0] rounded-xl cursor-pointer hover:border-[#c4c4c0]">
              <svg className="w-6 h-6 text-[#b4b4b0]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="text-[10px] text-[#b4b4b0] mt-1">Фото</span>
              <input type="file" accept="image/*" capture="environment" className="hidden"
                onChange={e => e.target.files?.[0] && addPhoto(e.target.files[0])} />
            </label>
          </div>
        </div>

        {/* Notes */}
        <div className="bg-white rounded-2xl border border-[#e4e4e0] p-4">
          <label className="block text-[11px] font-bold text-[#9a9a95] uppercase tracking-wider mb-2">Заметки</label>
          <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Особенности объекта, пожелания клиента..."
            className="w-full border border-[#e4e4e0] rounded-xl px-4 py-3 text-[14px] outline-none focus:border-[#0071e3] resize-none" />
        </div>

        {error && <p className="text-[13px] text-red-600 bg-red-50 px-4 py-3 rounded-xl">{error}</p>}
      </div>

      {/* Fixed submit button */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#e4e4e0] px-4 py-4">
        <button
          onClick={submit}
          disabled={saving}
          className="w-full py-4 bg-[#111110] text-white rounded-2xl text-[16px] font-bold disabled:opacity-40 active:opacity-80 transition-opacity"
        >
          {saving ? 'Отправка...' : 'Отправить замер →'}
        </button>
      </div>
    </div>
  )
}
