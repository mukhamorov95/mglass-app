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

// Вынесен на уровень модуля: компоненты нельзя создавать внутри рендера (static-components)
const Row = ({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) => (
  <div className={`flex items-center justify-between py-1.5 ${bold ? 'text-[15px] font-bold' : 'text-[13px]'} ${accent ? 'text-[#E1442E]' : 'text-[#111110]'}`}>
    <span className={bold ? '' : 'text-[#6b6b66]'}>{label}</span><span>{value}</span>
  </div>
)

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

  // Бонус дизайнера (партнёрка) и скидки — на итог по всем изделиям.
  const [designer, setDesigner] = useState<0 | 10 | 15>(0)
  const [measureDiscount, setMeasureDiscount] = useState('')
  const [extraMode, setExtraMode] = useState<'pct' | 'sum'>('pct')
  const [extraVal, setExtraVal] = useState('')

  const [recording, setRecording] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [speechSupported, setSpeechSupported] = useState(true)
  // Клиент — опционально: расчёт сохраняется и без него, но с ним попадёт в сделку.
  const [clientName, setClientName]   = useState('')
  const [clientPhone, setClientPhone] = useState('')
  const [objectAddress, setObjectAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const recognitionRef = useRef<ISpeechRecognition | null>(null)
  const lastSavedSigRef = useRef('')   // сигнатура последнего сохранённого снимка — гард от дублей
  const parentCalcIdRef = useRef<number | null>(null)  // первичный расчёт (при пересчёте из карточки)
  const reopenDealIdRef = useRef<number | null>(null)  // сделка пересчёта — вторичный ложится в неё же
  const transcriptRef = useRef('')
  // eslint-disable-next-line react-hooks/refs
  transcriptRef.current = transcript

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechSupported(typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window))
  }, [])

  // Список изделий, переданный со «Скана дизайн-проекта» — показываем справкой.
  const [scanRef, setScanRef] = useState('')
  useEffect(() => {
    try {
      const p = sessionStorage.getItem('quickcalc-prefill')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (p) { setScanRef(p); sessionStorage.removeItem('quickcalc-prefill') }
    } catch { /* ignore */ }
  }, [])

  // Переоткрытие сохранённого расчёта: снимок из истории/сделки кладётся сюда,
  // здесь восстанавливаем все поля, чтобы можно было пересчитать, а не только смотреть.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('mglass_quick_reopen')
      if (!raw) return
      sessionStorage.removeItem('mglass_quick_reopen')
      const p = JSON.parse(raw) as Record<string, unknown>
      const s = (k: string) => p[k] != null ? String(p[k]) : undefined
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (Array.isArray(p.cart)) setCart(p.cart as CartItem[])
      const set = (v: string | undefined, f: (x: string) => void) => { if (v != null) f(v) }
      set(s('title'), setTitle); set(s('glass'), setGlass); set(s('hw'), setHw)
      set(s('margin'), setMargin); set(s('tax'), setTax)
      set(s('perSection'), setPerSection); set(s('sections'), setSections)
      set(s('delivery'), setDelivery); set(s('lift'), setLift)
      set(s('measureDiscount'), setMeasureDiscount); set(s('extraVal'), setExtraVal)
      set(s('clientName'), setClientName); set(s('clientPhone'), setClientPhone); set(s('objectAddress'), setObjectAddress)
      if (p.designer === 10 || p.designer === 15) setDesigner(p.designer)
      if (p.extraMode === 'pct' || p.extraMode === 'sum') setExtraMode(p.extraMode)
      // Контекст пересчёта: связь с первичным и сделкой (см. карточку /deal).
      if (typeof p.__parentCalcId === 'number') parentCalcIdRef.current = p.__parentCalcId
      if (typeof p.__dealId === 'number') reopenDealIdRef.current = p.__dealId
    } catch { /* ignore */ }
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

  // Дизайнеру закладываем его % + 5% нам: выбрали 10% → накидываем 15% (10% дизайнеру,
  // 5% компании); 15% → 20%. Итог растёт на эту надбавку.
  const designerMarkupPct = designer > 0 ? designer + 5 : 0
  const designerMarkup = Math.round(grand * designerMarkupPct / 100)
  const grandWithDesigner = grand + designerMarkup
  const measureDisc = Math.min(grandWithDesigner, Math.max(0, numOr(measureDiscount)))
  const afterMeasure = grandWithDesigner - measureDisc
  const extraDisc = extraMode === 'pct'
    ? Math.round(afterMeasure * Math.max(0, numOr(extraVal)) / 100)
    : Math.min(afterMeasure, Math.max(0, numOr(extraVal)))
  const finalGrand = Math.max(0, afterMeasure - extraDisc)

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

  // Текущий состав: cart + незакоммиченное текущее изделие, если в нём есть данные.
  function currentList(): CartItem[] {
    const list: CartItem[] = [...cart]
    if (curHasData) list.push({ title: title.trim() || 'Изделие', productPrice, installTotal, sections: numOr(sections), perSection: numOr(perSection), delivery: deliveryN, lift: liftN, total })
    return list
  }

  async function toKp() {
    const list = currentList()
    if (!list.length) return
    // Расчёт, который менеджер понёс в КП, он точно считает настоящим — сохраняем
    // его в историю автоматически, без отдельного действия. Так история наполняется
    // сама на дошедших до клиента расчётах, а не зависит от привычки жать «Сохранить».
    await persistCalc({ silent: true })
    const multi = list.length > 1
    // Надбавку дизайнера закладываем в цены изделий (клиент видит уже с ней).
    const k = 1 + designerMarkupPct / 100
    const items: { name: string; qty?: number; price?: number; sum: number }[] = []
    for (const it of list) {
      const suf = multi ? ` — ${it.title}` : ''
      const pp = Math.round(it.productPrice * k)
      items.push({ name: it.title, qty: 1, price: pp, sum: pp })
      if (it.installTotal > 0) items.push({ name: `Монтаж${suf}`, qty: it.sections || 1, price: Math.round(it.perSection * k), sum: Math.round(it.installTotal * k) })
      if (it.delivery > 0) items.push({ name: `Доставка${suf}`, qty: 1, sum: Math.round(it.delivery * k) })
      if (it.lift > 0) items.push({ name: `Подъём${suf}`, qty: 1, sum: Math.round(it.lift * k) })
    }
    const subtotal = grandWithDesigner
    const content = { title: (list.length === 1 ? list[0].title : 'Коммерческое предложение').toUpperCase(), items, subtotal, total: finalGrand }
    try { sessionStorage.setItem('mglass_kp_prefill', JSON.stringify(content)) } catch { /* ignore */ }
    router.push('/kp')
  }

  // Единая точка сохранения в историю (calculations). Зовёт и кнопка (silent=false,
  // с сообщением), и переход в КП (silent=true, без шума). Раньше быстрый расчёт
  // нигде не сохранялся: посчитал → закрыл вкладку → всё пропало. Снимок всех
  // входных данных (+ cart) и итог ложатся в calculations, откуда расчёт можно
  // открыть и пересчитать.
  //
  // Гард по сигнатуре снимка: «Сохранить» + переход в КП по тем же данным не
  // создают дубль; повторный переход в КП без изменений — тоже. Изменил параметр —
  // сигнатура другая, сохранится новый расчёт (первичный остаётся).
  async function persistCalc({ silent }: { silent: boolean }): Promise<boolean> {
    const list = currentList()
    if (!list.length) { if (!silent) { setSaveMsg('Нечего сохранять'); setTimeout(() => setSaveMsg(null), 2500) } return false }
    const snapshot = {
      cart: list, title, glass, hw, margin, tax, perSection, sections,
      delivery, lift, designer, measureDiscount, extraMode, extraVal,
      clientName, clientPhone, objectAddress,
    }
    const sig = JSON.stringify(snapshot) + '|' + finalGrand
    if (sig === lastSavedSigRef.current) { if (!silent) { setSaveMsg('Уже сохранено ✓'); setTimeout(() => setSaveMsg(null), 2500) } return true }
    if (!silent) { setSaving(true); setSaveMsg(null) }
    try {
      const { saveCalculation } = await import('@/lib/saveCalculation')
      const label = list.length === 1 ? list[0].title : `Быстрый расчёт (${list.length} изд.)`
      const res = await saveCalculation({
        product_type: 'quick',
        input_data: snapshot,
        cost_breakdown: { directCost, productPrice, installTotal, delivery: deliveryN, lift: liftN },
        financial_breakdown: { marginPct: marginN, taxPct: taxN, designerMarkupPct, measureDisc, extraDisc, grand, finalGrand },
        base_price: grand,
        discount: measureDisc + extraDisc,
        partner_percent: 0,
        final_price: finalGrand,
        margin: marginN,
        profit: Math.max(0, Math.round(finalGrand - directCost)),
        client_text: [label, objectAddress && `Адрес: ${objectAddress}`].filter(Boolean).join(' · '),
        client_name: clientName.trim() || undefined,
        client_phone: clientPhone.trim() || undefined,
        // Связь первичный→вторичный: пересчёт из карточки помнит родителя.
        parent_calc_id: parentCalcIdRef.current ?? undefined,
      })
      const ok = !!(res && 'id' in res && res.id)
      if (!ok) { if (!silent) setSaveMsg(res && 'error' in res ? res.error! : 'Не удалось сохранить'); return false }
      lastSavedSigRef.current = sig
      const newId = (res as { id: number }).id
      let createdDeal = false
      if (reopenDealIdRef.current) {
        // Пересчёт из карточки — тот же объект: кладём вторичный в ту же сделку,
        // не спрашивая (человек уже выбрал объект, открыв карточку).
        try {
          await fetch(`/api/deals/${reopenDealIdRef.current}/attach`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ calc_id: newId }),
          })
        } catch { /* привяжется вручную из «требуют привязки» */ }
      } else if (clientPhone.trim() || objectAddress.trim()) {
        // Новый расчёт с телефоном/адресом: сервер решает создать/спросить/осиротеть
        // (/api/deals/ensure). Создание ≠ склейка — молча только новый объект.
        try {
          const er = await fetch('/api/deals/ensure', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ calc_id: newId, client_name: clientName.trim(), phone: clientPhone.trim(), address: objectAddress.trim() }),
          }).then(x => x.json()).catch(() => null)
          createdDeal = !!er?.created
        } catch { /* заведём позже вручную из «требуют привязки» */ }
      }
      if (!silent) setSaveMsg(createdDeal ? 'Сохранено, заведена сделка ✓' : 'Сохранено в историю расчётов ✓')
      return true
    } finally {
      if (!silent) { setSaving(false); setTimeout(() => setSaveMsg(null), 4000) }
    }
  }
  const saveQuick = () => persistCalc({ silent: false })

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold text-[#111110]">Быстрый расчёт</h1>
          <p className="text-[12px] text-[#9a9a95] mt-0.5">Прозрачный расчёт по формуле: себестоимость → рекомендованная цена. Можно надиктовать голосом и добавить несколько изделий.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] gap-4 items-start">
          <div className="space-y-4">
            {scanRef && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700">📐 Из скана дизайн-проекта</p>
                  <button onClick={() => setScanRef('')} className="text-[12px] text-amber-700 hover:text-amber-900">✕ Скрыть</button>
                </div>
                <pre className="text-[12px] whitespace-pre-wrap font-sans text-[#6b6b66] max-h-52 overflow-y-auto">{scanRef}</pre>
                <p className="text-[11px] text-amber-700 mt-1.5">Считай изделия по одному: надиктуй или впиши себестоимость — список останется здесь для сверки.</p>
              </div>
            )}
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
                <Row label={`Сумма${cart.length ? ` (${cart.length + (curHasData ? 1 : 0)} изд.)` : ''}`} value={`${RUB(grand)} ₽`} bold />

                {/* Бонус дизайнера (партнёрка) */}
                <div className="mt-3 pt-3 border-t border-[#e4e4e0]">
                  <label className="block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1">Бонус дизайнера</label>
                  <div className="flex bg-[#efefec] rounded-lg p-[3px] gap-[2px]">
                    {([[0, 'Без дизайнера'], [10, 'Дизайнер 10%'], [15, 'Дизайнер 15%']] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setDesigner(v)}
                        className={`flex-1 text-[12px] font-medium rounded-md py-1.5 ${designer === v ? 'bg-white shadow-sm text-[#111110]' : 'text-[#9a9a95]'}`}>{l}</button>
                    ))}
                  </div>
                  {designer > 0 && (
                    <Row label={`Надбавка +${designerMarkupPct}% (дизайнеру ${designer}%, нам 5%)`} value={`+${RUB(designerMarkup)} ₽`} />
                  )}
                </div>

                {/* Скидки */}
                <div className="mt-3 pt-3 border-t border-[#e4e4e0] space-y-2">
                  <div className="flex items-center gap-2">
                    <label className="text-[12px] text-[#6b6b66] flex-1">Скидка замера, ₽</label>
                    <input value={measureDiscount} onChange={e => setMeasureDiscount(e.target.value)} placeholder="0"
                      className="w-28 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-[12px] text-[#6b6b66] flex-1">Доп. скидка</label>
                    <div className="flex bg-[#efefec] rounded-lg p-[2px] gap-[2px]">
                      {([['pct', '%'], ['sum', '₽']] as const).map(([v, l]) => (
                        <button key={v} onClick={() => setExtraMode(v)}
                          className={`text-[12px] font-medium rounded-md px-2.5 py-1 ${extraMode === v ? 'bg-white shadow-sm text-[#111110]' : 'text-[#9a9a95]'}`}>{l}</button>
                      ))}
                    </div>
                    <input value={extraVal} onChange={e => setExtraVal(e.target.value)} placeholder="0"
                      className="w-24 bg-white border border-[#e4e4e0] rounded-lg px-2 py-1 text-[13px] font-mono text-right outline-none focus:border-[#111110]" />
                  </div>
                  {measureDisc > 0 && <Row label="Скидка замера" value={`−${RUB(measureDisc)} ₽`} />}
                  {extraDisc > 0 && <Row label={`Доп. скидка${extraMode === 'pct' ? ` (${numOr(extraVal)}%)` : ''}`} value={`−${RUB(extraDisc)} ₽`} />}
                </div>

                <div className="border-t-2 border-[#111110] mt-3 mb-1" />
                <Row label={`К оплате${cart.length ? ` (${cart.length + (curHasData ? 1 : 0)} изд.)` : ''}`} value={`${RUB(finalGrand)} ₽`} bold accent />
              </>
            )}

            {/* Клиент — опционально: расчёт сохранится и без него. С клиентом
                он позже привяжется к сделке (шаг 2). Обязательным не делаем —
                иначе не поймать расчёт «на бегу», посреди разговора. */}
            {grand > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-1.5">
                <input value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Клиент (необязательно)"
                  className="w-full bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                <div className="grid grid-cols-2 gap-1.5">
                  <input value={clientPhone} onChange={e => setClientPhone(e.target.value)} placeholder="Телефон" inputMode="tel"
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                  <input value={objectAddress} onChange={e => setObjectAddress(e.target.value)} placeholder="Адрес объекта"
                    className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:border-[#111110]" />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={saveQuick} disabled={grand <= 0 || saving}
                className="px-4 py-2.5 border border-[#111110] text-[#111110] text-[13px] font-semibold rounded-lg hover:bg-[#f0f0ec] disabled:opacity-50">
                {saving ? 'Сохраняю…' : '💾 Сохранить расчёт'}
              </button>
              <button onClick={toKp} disabled={grand <= 0}
                className="px-4 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50">
                Сформировать КП →
              </button>
            </div>
            <p className="text-[11px] text-[#9a9a95] mt-2 text-center">
              {saveMsg ?? 'Сохранённый расчёт появится в истории — его можно открыть и пересчитать'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
