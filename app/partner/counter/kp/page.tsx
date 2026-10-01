'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { renderDocCanvas } from '@/lib/pdfCapture'
import { DEFAULT_WORKING_DAYS } from '@/lib/b2b/deadline'
import { readDraft, retailQuote, describeSpec, DEFAULT_MARKUP_PCT, type CounterSpec } from '@/lib/partner/counter'

// КП покупателю точки — от имени партнёра, с его розничной ценой. Ни бренда, ни цен
// M-Glass на листе нет: покупатель покупает у партнёра. Позиции — из черновика
// прилавка, цены пересчитываются сервером при каждом открытии (прайс мог смениться).
// Имя покупателя живёт только в этом поле: не уходит на сервер и не пишется в
// браузер — персональные данные чужого клиента нам хранить незачем (152-ФЗ).

type Priced = { material: string; thickness: number; lineTotal: number }
type Settings = { markupPct: number; kpName: string; kpPhone: string; kpNote: string }

const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₽'
const today = () => new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })

export default function CounterKpPage() {
  const [specs, setSpecs] = useState<CounterSpec[]>([])
  const [items, setItems] = useState<Priced[] | null>(null)
  const [settings, setSettings] = useState<Settings>({ markupPct: DEFAULT_MARKUP_PCT, kpName: '', kpPhone: '', kpNote: '' })
  const [defaults, setDefaults] = useState<{ name: string; phone: string }>({ name: '', phone: '' })
  const [buyer, setBuyer] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const draft = readDraft()
    Promise.all([
      fetch('/api/partner/settings').then(r => r.ok ? r.json() : null).catch(() => null),
      draft.length
        ? fetch('/api/partner/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: draft, save: false }) })
            .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }))
        : Promise.resolve(null),
    ]).then(([s, q]) => {
      setSpecs(draft)
      if (s?.settings) setSettings(s.settings as Settings)
      if (s?.defaults) setDefaults(s.defaults)
      if (q && (!q.ok || !q.d.ok)) setError(q.d.error || 'Цена не посчитана')
      else if (q) setItems(q.d.items as Priced[])
    }).catch(() => setError('Сеть недоступна')).finally(() => setLoading(false))
  }, [])

  async function downloadPdf() {
    if (!docRef.current) return
    try {
      const jspdf = await import('jspdf')
      const canvas = await renderDocCanvas(docRef.current)
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`КП-${new Date().toISOString().slice(0, 10)}.pdf`)
    } catch {
      alert('Не удалось сформировать PDF. Используйте «Печать» → Сохранить как PDF.')
    }
  }

  if (loading) return <div className="wrap"><div className="note"><div className="s">Загрузка…</div></div></div>
  if (specs.length === 0) return (
    <div className="wrap"><div className="note">
      <div className="t">На прилавке пусто</div>
      <div className="s">Добавьте детали на «Прилавке» — КП соберётся из них.</div>
      <Link href="/partner/counter" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← Прилавок</Link>
    </div></div>
  )
  if (error || !items || items.length !== specs.length) return (
    <div className="wrap"><div className="note">
      <div className="t">КП не собрано</div>
      <div className="s">{error || 'Цена не посчитана'}. Без цены лист не печатаем.</div>
      <Link href="/partner/counter" className="s" style={{ display: 'inline-block', marginTop: 10, color: 'var(--blue)' }}>← Прилавок</Link>
    </div></div>
  )

  const retail = retailQuote(items.map(i => i.lineTotal), settings.markupPct)
  const seller = settings.kpName || defaults.name
  const phone = settings.kpPhone || defaults.phone

  return (
    <>
      <style>{`
        body{background:#ececea}
        #retail-kp, #retail-kp * { color:#111110; font-family: -apple-system, 'Segoe UI', Roboto, Arial, sans-serif; }
        #retail-kp table { border-collapse: collapse; width: 100%; }
        @media print {
          body * { visibility: hidden !important; }
          #retail-kp, #retail-kp * { visibility: visible !important; }
          #retail-kp { position: fixed; top: 0; left: 0; width: 100%; box-shadow: none !important; margin: 0 !important; }
          .no-print { display: none !important; }
          @page { margin: 14mm; size: A4; }
        }
      `}</style>

      <div className="no-print" style={{ maxWidth: 820, margin: '0 auto', padding: '18px 16px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Link href="/partner/counter" className="ghost">‹ Прилавок</Link>
        <div className="fld" style={{ flex: '1 1 200px', minWidth: 0 }}><input value={buyer} onChange={e => setBuyer(e.target.value)} maxLength={80} placeholder="Для кого (необязательно)" autoComplete="off" /></div>
        <button onClick={() => document.fonts.ready.then(() => window.print())} className="ghost">🖨 Печать</button>
        <button onClick={downloadPdf} className="primary">⬇ PDF</button>
      </div>
      <div className="no-print cap" style={{ maxWidth: 820, margin: '6px auto 0', padding: '0 16px' }}>
        Имя покупателя остаётся только на этом листе — мы его не сохраняем. Шапку и наценку ({settings.markupPct.toLocaleString('ru-RU')}%) меняете в <Link href="/partner/profile#counter" style={{ color: 'var(--blue)' }}>профиле</Link>.
      </div>

      <div style={{ overflowX: 'auto', padding: '0 0 24px' }}>
        <div ref={docRef} id="retail-kp" style={{ width: 760, margin: '16px auto', background: '#fff', padding: '36px 40px', boxShadow: '0 2px 18px rgba(0,0,0,.08)', fontSize: 13, lineHeight: 1.45 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderBottom: '2px solid #111110', paddingBottom: 14 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{seller}</div>
              {phone && <div style={{ fontSize: 13, marginTop: 2 }}>{phone}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>Коммерческое предложение</div>
              <div style={{ fontSize: 12, color: '#6b6b66' }}>от {today()}</div>
            </div>
          </div>

          {buyer.trim() && <div style={{ marginTop: 14 }}><span style={{ color: '#6b6b66' }}>Для:</span> {buyer.trim()}</div>}

          <table style={{ marginTop: 16 }}>
            <thead>
              <tr style={{ borderBottom: '1.5px solid #111110' }}>
                <th style={{ textAlign: 'left', padding: '7px 4px', width: 28 }}>№</th>
                <th style={{ textAlign: 'left', padding: '7px 4px' }}>Изделие</th>
                <th style={{ textAlign: 'left', padding: '7px 4px' }}>Размер, мм</th>
                <th style={{ textAlign: 'right', padding: '7px 4px' }}>Кол-во</th>
                <th style={{ textAlign: 'right', padding: '7px 4px' }}>Сумма</th>
              </tr>
            </thead>
            <tbody>
              {specs.map((s, i) => {
                const extra = describeSpec(s)
                return (
                  <tr key={i} style={{ borderBottom: '1px solid #e4e4e0' }}>
                    <td style={{ padding: '7px 4px', color: '#6b6b66' }}>{i + 1}</td>
                    <td style={{ padding: '7px 4px' }}>{items[i].material} {items[i].thickness} мм{extra ? `, ${extra}` : ''}</td>
                    <td style={{ padding: '7px 4px', fontVariantNumeric: 'tabular-nums' }}>{s.width} × {s.height}</td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{s.quantity}</td>
                    <td style={{ padding: '7px 4px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(retail.lines[i])}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} style={{ padding: '12px 4px', textAlign: 'right', fontWeight: 700, fontSize: 14 }}>Итого:</td>
                <td style={{ padding: '12px 4px', textAlign: 'right', fontWeight: 700, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>{fmt(retail.total)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ marginTop: 14, fontSize: 12.5 }}>
            Срок изготовления — ориентировочно {DEFAULT_WORKING_DAYS} рабочих дней с момента оплаты. Изделия режутся точно по размерам, указанным в предложении.
          </div>
          {settings.kpNote && <div style={{ marginTop: 10, fontSize: 12.5, whiteSpace: 'pre-wrap' }}>{settings.kpNote}</div>}
        </div>
      </div>
    </>
  )
}
