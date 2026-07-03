'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { calcFinancialModel } from '@/lib/pricing/financialModel'

interface ISpeechRecognition extends EventTarget {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onresult: ((e: any) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SRWindow = { SpeechRecognition?: new () => ISpeechRecognition; webkitSpeechRecognition?: new () => ISpeechRecognition }

const numOr = (v: string) => { const n = Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const RUB = (n: number) => Math.round(n).toLocaleString('ru-RU')

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[14px] outline-none focus:border-[#111110] bg-white'

type CartItem = { title: string; productPrice: number; installTotal: number; sections: number; perSection: number; delivery: number; lift: number; total: number }

export default function QuickCalcPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [glass, setGlass] = useState('')
  const [hw, setHw] = useState('')
  const [margin, setMargin] = useState('40')
  const [tax, setTax] = useState('12')
  const [perSection, setPerSection] = useState('')
  const [sections, setSections] = useState('1')
  const [delivery, setDelivery] = useState('')
  const [lift, setLift] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])

  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [speechSupported, setSpeechSupported] = useState(true)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  transcriptRef.current = transcript

  useEffect(() => {
    setSpeechSupported(typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window))
  }, [])

  const glassCost = numOr(glass), hwCost = numOr(hw)
  const directCost = glassCost + hwCost
  const marginN = numOr(margin), taxN = numOr(tax)
  const fin = calcFinancialModel({ directCost, marginPercent: marginN, taxPercent: taxN })
  const productPrice = fin ? fin.basePrice : 0
  const installTotal = numOr(perSection) * numOr(sections)
  const deliveryN = numOr(delivery), liftN = numOr(lift)
  const total = productPrice + installTotal + deliveryN + liftN
  const denom = 1 - marginN / 100 - taxN / 100
  const curHasData = !!(title.trim() || directCost > 0 || total > 0)
  const grand = cart.reduce((s, c) => s + c.total, 0) + (curHasData ? total : 0)

  // ── voice ──────────────────────────────────────────────
  function startRec() {
    const w = window as unknown as SRWindow
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR) { setBusy('Голос не поддерживается — впишите вручную'); setTimeout(() => setBusy(null), 3000); return }
    const rec = new SR()
    rec.lang = 'ru-RU'; rec.continuous = true; rec.interimResults = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let intr = '', fin2 = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const tr = e.results[i][0].transcript
        if (e.results[i].isFinal) fin2 += tr; else intr += tr
      }
      if (fin2) setTranscript(p => (p && !p.endsWith(' ') ? p + ' ' : p) + fin2)
      setInterim(intr)
    }
    rec.onerror = () => { setRecording(false); setInterim('') }
    rec.onend = () => { setRecording(false); setInterim('') }
    recognitionRef.current = rec
    rec.start(); setRecording(true); setBusy(null)
  }
  function stopRec() {
    recognitionRef.current?.stop(); setRecording(false); setInterim('')
    setTimeout(() => { const t = transcriptRef.current.trim(); if (t) parseVoice(t) }, 350)
  }
  async function parseVoice(t: string) {
    setBusy('Разбираю…')
    try {
      const r = await fetch('/api/ai/quick-parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: t }) }).then(x => x.json())
      const f = r.fields
      if (!f) { setBusy(r.error || 'не распознано'); setTimeout(() => setBusy(null), 2500); return }
      if (f.title != null) setTitle(String(f.title))
      if (f.glass_cost != null) setGlass(String(f.glass_cost))
      if (f.hw_cost != null) setHw(String(f.hw_cost))
      if (f.per_section != null) setPerSection(String(f.per_section))
      if (f.sections != null) setSections(String(f.sections))
      if (f.delivery != null) setDelivery(String(f.delivery))
      if (f.lift != null) setLift(String(f.lift))
      if (f.margin != null) setMargin(String(f.margin))
      if (f.tax != null) setTax(String(f.tax))
      setBusy('✓ разобрано'); setTimeout(() => setBusy(null), 1500)
    } catch { setBusy('ошибка сети'); setTimeout(() => setBusy(null), 2500) }
  }

  // ── cart ───────────────────────────────────────────────
  function addToCart() {
    if (!curHasData) return
    setCart(c => [...c, { title: title.trim() || 'Изделие', productPrice, installTotal, sections: numOr(sections), perSection: numOr(perSection), delivery: deliveryN, lift: liftN, total }])
    setTitle(''); setGlass(''); setHw(''); setPerSection(''); setSections('1'); setDelivery(''); setLift(''); setTranscript('')
  }
  const removeCart = (i: number) => setCart(c => c.filter((_, j) => j !== i))

  function toKp() {
    const list: CartItem[] = [...cart]
    if (curHasData) list.push({ title: title.trim() || 'Изделие', productPrice, installTotal, sections: numOr(sections), perSection: numOr(perSection), delivery: deliveryN, lift: liftN, total })
    if (!list.length) return
    const multi = list.length > 1
    const items: { name: string; qty?: number; price?: number; sum: number }[] = []
    for (const it of list) {
      const suf = multi ? ` — ${it.title}` : ''
      items.push({ name: it.title, qty: 1, price: Math.round(it.productPrice), sum: Math.round(it.productPrice) })
      if (it.installTotal > 0) items.push({ name: `Монтаж${suf}`, qty: it.sections || 1, price: Math.round(it.perSection), sum: Math.round(it.installTotal) })
      if (it.delivery > 0) items.push({ name: `Доставка${suf}`, qty: 1, sum: Math.round(it.delivery) })
      if (it.lift > 0) items.push({ name: `Подъём${suf}`, qty: 1, sum: Math.round(it.lift) })
    }
    const g = Math.round(list.reduce((s, it) => s + it.total, 0))
    const content = { title: (list.length === 1 ? list[0].title : 'Коммерческое предложение').toUpperCase(), items, subtotal: g, total: g }
    try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch { /* ignore */ }
    router.push('/kp')
  }

  const Row = ({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) => (
    <div className={`flex items-center justify-between py-1.5 ${bold ? 'text-[15px] font-bold' : 'text-[13px]'} ${accent ? 'text-[#E1442E]' : 'text-[#111110]'}`}>
      <span className={bold ? '' : 'text-[#6b6b66]'}>{label}</span><span>{value}</span>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-[#111110]">Быстрый расчёт</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Прозрачный расчёт по формуле: себестоимость → рекомендованная цена. Можно надиктовать голосом и добавить несколько изделий.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="space-y-4">
            {/* Голос */}
            <div className="bg-white border border-dashed border-[#d8d8d3] rounded-xl p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={recording ? stopRec : startRec}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-[13px] font-semibold ${recording ? 'bg-red-600 text-white animate-pulse' : 'bg-[#E1442E] text-white hover:bg-[#c93a26]'}`}>
                  {recording ? '⏹ Остановить и разобрать' : '🎤 Надиктовать изделие'}
                </button>
                {busy && <span className="text-[12px] text-[#6b6b66]">{busy}</span>}
                {recording && <span className="text-[12px] text-red-500">● говорите: наименование, себестоимость стекла и фурнитуры, монтаж за секцию, кол-во секций…</span>}
              </div>
              {!speechSupported && <p className="text-[12px] text-amber-600 mt-2">Голос недоступен в этом браузере — впишите вручную.</p>}
              {(transcript || interim) && <p className="text-[12px] text-[#9a9a95] mt-2 italic">{transcript}{interim ? ' ' + interim : ''}</p>}
            </div>

            {/* Изделие */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Изделие</p>
              <div className="mb-3"><label className={L}>Наименование</label>
                <input className={I} value={title} onChange={e => setTitle(e.target.value)} placeholder="Зеркало с подсветкой / Душевая перегородка…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={L}>Себестоимость стекла/зеркала, ₽</label><input className={I} value={glass} onChange={e => setGlass(e.target.value)} placeholder="почём для M-Glass" /></div>
                <div><label className={L}>Себестоимость фурнитуры, ₽</label><input className={I} value={hw} onChange={e => setHw(e.target.value)} placeholder="0 если нет" /></div>
                <div><label className={L}>Маржа, %</label><input className={I} value={margin} onChange={e => setMargin(e.target.value)} /></div>
                <div><label className={L}>Налог, %</label><input className={I} value={tax} onChange={e => setTax(e.target.value)} /></div>
              </div>
              {denom <= 0 && <p className="text-[12px] text-red-600 mt-2">Маржа + налог ≥ 100% — формула не считается.</p>}
            </div>

            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Работы и логистика</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={L}>Монтаж за секцию, ₽</label><input className={I} value={perSection} onChange={e => setPerSection(e.target.value)} placeholder="0 если нет" /></div>
                <div><label className={L}>Количество секций</label><input className={I} value={sections} onChange={e => setSections(e.target.value)} /></div>
                <div><label className={L}>Доставка, ₽</label><input className={I} value={delivery} onChange={e => setDelivery(e.target.value)} placeholder="стандартная" /></div>
                <div><label className={L}>Подъём, ₽</label><input className={I} value={lift} onChange={e => setLift(e.target.value)} placeholder="0 = не считается" /></div>
              </div>
            </div>

            {/* Корзина изделий */}
            {cart.length > 0 && (
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                <p className="text-[13px] font-semibold text-[#111110] mb-2">Изделия в расчёте ({cart.length})</p>
                <div className="divide-y divide-[#f5f5f3]">
                  {cart.map((c, i) => (
                    <div key={i} className="flex items-center justify-between py-2 text-[13px]">
                      <span className="text-[#111110]">{c.title}</span>
                      <span className="flex items-center gap-3">
                        <span className="font-semibold">{RUB(c.total)} ₽</span>
                        <button onClick={() => removeCart(i)} className="text-[#c4c4be] hover:text-red-500">✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Результат */}
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 md:sticky md:top-4">
            <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-2">Текущее изделие</p>
            <Row label="Себестоимость (стекло + фурнитура)" value={`${RUB(directCost)} ₽`} />
            <div className="text-[11px] text-[#9a9a95] pb-1.5 leading-snug">
              {RUB(directCost)} ÷ (1 − {marginN}% − {taxN}%) = <b className="text-[#111110]">{RUB(productPrice)} ₽</b>
            </div>
            <Row label="Цена изделия" value={`${RUB(productPrice)} ₽`} />
            {installTotal > 0 && <Row label={`Монтаж (${numOr(sections)} × ${RUB(numOr(perSection))})`} value={`${RUB(installTotal)} ₽`} />}
            {deliveryN > 0 && <Row label="Доставка" value={`${RUB(deliveryN)} ₽`} />}
            {liftN > 0 && <Row label="Подъём" value={`${RUB(liftN)} ₽`} />}
            <div className="border-t border-[#f0f0ec] my-1" />
            <Row label="Сумма изделия" value={`${RUB(total)} ₽`} bold />

            <button onClick={addToCart} disabled={!curHasData}
              className="w-full mt-3 px-4 py-2 bg-white border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f5f5f3] disabled:opacity-40">
              + Добавить изделие
            </button>

            {(cart.length > 0 || curHasData) && (
              <>
                <div className="border-t-2 border-[#111110] mt-3 mb-1" />
                <Row label={`Итого клиенту${cart.length ? ` (${cart.length + (curHasData ? 1 : 0)} изд.)` : ''}`} value={`${RUB(grand)} ₽`} bold accent />
              </>
            )}

            <button onClick={toKp} disabled={grand <= 0}
              className="w-full mt-3 px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50">
              Сформировать КП →
            </button>
            <p className="text-[11px] text-[#9a9a95] mt-2 text-center">Данные подтянутся в редактор КП</p>
          </div>
        </div>
      </div>
    </div>
  )
}
