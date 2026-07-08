'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'

// Справочник «Зеркало в металлической раме»: ставки себестоимости рамы (металл,
// резка, сварка, покраска, сборка) — их использует режим «Зеркало+свет/рама» в
// B2B-калькуляторе. Плюс референс-чертежи (чертёж зеркала + крой) для понимания.

type Rate = { key: string; label: string; unit: string; value: number; sort: number }
type Ref = { id: number; url: string; label: string | null }

export default function MirrorFrameRatesPage() {
  const sb = createClient()
  const [rates, setRates] = useState<Rate[]>([])
  const [refs, setRefs] = useState<Ref[]>([])
  const [loading, setLoading] = useState(true)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const load = useCallback(async () => {
    const [{ data: r }, { data: rf }] = await Promise.all([
      sb.from('mirror_frame_rates').select('*').order('sort'),
      sb.from('mirror_frame_refs').select('id,url,label').order('id', { ascending: false }),
    ])
    setRates((r ?? []) as Rate[])
    setRefs((rf ?? []) as Ref[])
    setLoading(false)
  }, [sb])
  useEffect(() => { load() }, [load])

  async function save(key: string, value: number) {
    setRates(prev => prev.map(r => r.key === key ? { ...r, value } : r))
    const { error } = await sb.from('mirror_frame_rates').update({ value }).eq('key', key)
    if (!error) { setSavedKey(key); setTimeout(() => setSavedKey(null), 1200) }
  }

  async function uploadRef(file: File, kind: string) {
    setUploading(true)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `mirror-frame-refs/${Date.now()}-${kind}.${ext}`
      const { error } = await sb.storage.from('b2b-attachments').upload(path, file, { upsert: true })
      if (error) return
      const { data } = sb.storage.from('b2b-attachments').getPublicUrl(path)
      await sb.from('mirror_frame_refs').insert({ url: data.publicUrl, label: kind })
      await load()
    } finally { setUploading(false) }
  }

  async function delRef(id: number) {
    if (!confirm('Удалить референс?')) return
    await sb.from('mirror_frame_refs').delete().eq('id', id)
    setRefs(prev => prev.filter(r => r.id !== id))
  }

  const total = rates.reduce((s, r) => s + Number(r.value || 0), 0)

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">Загрузка…</div>

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Зеркало в металлической раме — ставки</h1>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Себестоимость рамы к зеркалу: металл, резка, сварка, покраска, сборка. Само зеркало считается по площади (как обычно). Итог — по стандартной формуле (маржа/налог из «Ценообразования v2», категория mirror). Меняются здесь — сразу действуют в режиме «Зеркало+свет/рама».</p>
      </div>

      <div className="px-5 pt-4 max-w-[720px] space-y-4">
        <div className="bg-white rounded-xl border border-[#e4e4e0] divide-y divide-[#f5f5f3]">
          {rates.map(r => (
            <div key={r.key} className="flex items-center gap-3 px-4 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-[#111110]">{r.label}</p>
                <p className="text-[11px] text-[#9a9a95]">{r.unit}</p>
              </div>
              <input type="number" value={r.value}
                onChange={e => setRates(prev => prev.map(x => x.key === r.key ? { ...x, value: Number(e.target.value) } : x))}
                onBlur={e => save(r.key, Number(e.target.value) || 0)}
                className="w-28 bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
              {savedKey === r.key && <span className="text-[11px] text-emerald-600">✓</span>}
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[#fafaf9]">
            <p className="text-[13px] font-semibold text-[#111110]">Итого рама (себестоимость)</p>
            <p className="text-[14px] font-bold text-[#111110] font-mono">{total.toLocaleString('ru-RU')} ₽</p>
          </div>
        </div>

        {/* Референс-чертежи */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] p-4">
          <p className="text-[13px] font-semibold text-[#111110] mb-1">Референс-чертежи</p>
          <p className="text-[11px] text-[#9a9a95] mb-3">Загрузите примеры: чертёж зеркала на согласование и крой рамы. Нужны для понимания конструктива и будущего точного расчёта.</p>
          <div className="flex gap-2 flex-wrap mb-3">
            <label className={`px-3 py-1.5 bg-[#111110] text-white text-[12px] font-medium rounded-lg cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              {uploading ? 'Загрузка…' : '📐 Чертёж зеркала'}
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadRef(f, 'чертёж'); e.target.value = '' }} />
            </label>
            <label className={`px-3 py-1.5 bg-white border border-[#e4e4e0] text-[#6b6b66] text-[12px] font-medium rounded-lg cursor-pointer ${uploading ? 'opacity-50' : ''}`}>
              ✂️ Крой рамы
              <input type="file" accept="image/*,application/pdf" className="hidden" disabled={uploading}
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadRef(f, 'крой'); e.target.value = '' }} />
            </label>
          </div>
          {refs.length === 0 ? (
            <p className="text-[12px] text-[#9a9a95]">Пока нет референсов.</p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {refs.map(rf => (
                <div key={rf.id} className="relative">
                  <a href={rf.url} target="_blank" rel="noreferrer" className="block">
                    {/\.pdf(\?|$)/i.test(rf.url)
                      ? <div className="w-24 h-24 flex items-center justify-center border border-[#e4e4e0] rounded-lg text-[11px] text-blue-600">📄 {rf.label}</div>
                      /* eslint-disable-next-line @next/next/no-img-element */
                      : <img src={rf.url} alt={rf.label ?? ''} className="w-24 h-24 object-cover rounded-lg border border-[#e4e4e0]" />}
                  </a>
                  <button onClick={() => delRef(rf.id)} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-white border border-[#e4e4e0] text-[#9a9a95] hover:text-red-500 text-[11px]">✕</button>
                  {rf.label && <p className="text-[10px] text-[#9a9a95] text-center mt-0.5">{rf.label}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
