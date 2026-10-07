'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { renderDocCanvas } from '@/lib/pdfCapture'
import { entityTitle, type B2BLegalEntity } from '@/lib/b2bLegalEntities'
import InvoiceDocument from '@/components/InvoiceDocument'
import DocSkeleton from '@/components/DocSkeleton'
import { toast, responseError, NETWORK_ERROR } from '@/lib/toast'
import { promptDialog } from '@/lib/dialog'

// ─── Types ──────────────────────────────────────────────────────────────────
type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  saleIncVat?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  shape?: string
  comment?: string
  services?: { id: number; name: string; cost: number }[]
}
type Order = {
  id: number
  client_id: number | null
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  discount_percent: number
  items: OrderItem[]
  total_sale_inc_vat: number
  total_after_discount: number
  notes: string | null
  created_at: string
}
type Client = {
  id: number
  name: string
  full_name?: string | null
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  legal_address?: string | null
  bank_account?: string | null
  bank_name?: string | null
  bik?: string | null
  corr_account?: string | null
  supply_contract_no?: string | null
  supply_contract_date?: string | null
}
type Requisites = {
  full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string
  bank_account: string; bank_name: string; bik: string; corr_account: string
  supply_contract_no: string; supply_contract_date: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const EMPTY: Requisites = { full_name: '', inn: '', kpp: '', ogrn: '', legal_address: '', bank_account: '', bank_name: '', bik: '', corr_account: '', supply_contract_no: '', supply_contract_date: '' }

// Реквизиты из юрлица или карточки клиента (одинаковые имена полей).
function toReq(src: Record<string, unknown> | null | undefined): Requisites {
  const s = (k: string) => (src?.[k] as string | null | undefined) ?? ''
  return {
    full_name: s('full_name') || s('name'),
    inn: s('inn'), kpp: s('kpp'), ogrn: s('ogrn'), legal_address: s('legal_address'),
    bank_account: s('bank_account'), bank_name: s('bank_name'), bik: s('bik'), corr_account: s('corr_account'),
    supply_contract_no: s('supply_contract_no'), supply_contract_date: s('supply_contract_date'),
  }
}

// ─── Component ──────────────────────────────────────────────────────────────
export default function InvoicePage() {
  const params = useParams()
  const id = Number(params.id)

  const [order, setOrder] = useState<Order | null>(null)
  const [req, setReq] = useState<Requisites>(EMPTY)
  const [buyerName, setBuyerName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [parseText, setParseText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [showEditor, setShowEditor] = useState(true)
  const [entities, setEntities] = useState<B2BLegalEntity[]>([])
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null)
  const docRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/quotes/${id}/invoice-data`)
      .then(async r => {
        if (!r.ok) { setError(r.status === 403 ? 'Нет доступа к этому расчёту' : 'Расчёт не найден'); setLoading(false); return }
        const { order: o, client, entities: ents } = await r.json() as { order: Order; client: Client | null; entities: B2BLegalEntity[] }
        setOrder(o)
        setBuyerName(o.client_name || client?.name || 'Клиент')
        const list = ents ?? []
        setEntities(list)
        const def = list.find(e => e.is_default) ?? list[0] ?? null
        if (def) { setSelectedEntityId(def.id); setReq(toReq(def)) }
        else if (client) { setReq(toReq(client)) }
        setLoading(false)
      })
      .catch(() => { setError(NETWORK_ERROR); setLoading(false) })
  }, [id])

  async function refreshEntities(selectId?: number | null) {
    let r: Response
    try { r = await fetch(`/api/quotes/${id}/invoice-data`) } catch {
      toast.error('Список юрлиц не обновился', { detail: NETWORK_ERROR }); return
    }
    if (!r.ok) { toast.error('Список юрлиц не обновился', { detail: await responseError(r) }); return }
    const j = await r.json().catch(() => null) as { entities?: B2BLegalEntity[] } | null
    if (j?.entities) {
      setEntities(j.entities)
      if (selectId != null) setSelectedEntityId(selectId)
    }
  }

  // Счёт становится записью: печать/PDF регистрируют его в реестре побочным
  // эффектом (без отдельного действия менеджера). API идемпотентен по набору
  // заказов, поэтому повторная печать не плодит дубли и не «прыгает» номером.
  const [regLoading, setRegLoading] = useState(false)
  const [regMsg, setRegMsg] = useState<string | null>(null)
  const registeredRef = useRef(false)

  async function postInvoice(): Promise<{ ok: boolean; error?: string; updated?: boolean }> {
    if (!order) return { ok: false, error: 'Расчёт не загружен' }
    const amount = order.total_after_discount || order.total_sale_inc_vat || 0
    let r: Response
    try { r = await fetch('/api/invoices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoice_no: order.custom_number?.trim() || String(order.id).padStart(5, '0'),
        payer_client_id: order.client_id,
        payer_entity_id: selectedEntityId,
        payer_name: req.full_name || buyerName,
        order_ids: [order.id],
        amount,
        vat: Math.round(amount * 22 / 122),
      }),
    }) } catch { return { ok: false, error: NETWORK_ERROR } }
    if (!r.ok) return { ok: false, error: await responseError(r) }
    const j = await r.json().catch(() => ({})) as { updated?: boolean }
    return { ok: true, updated: j.updated === true }
  }

  // Явная кнопка — с обратной связью. Оставлена как подтверждение, но основной
  // путь — авто-регистрация на печати/PDF ниже.
  async function registerInvoice() {
    if (!order) return
    setRegLoading(true); setRegMsg(null)
    try {
      const res = await postInvoice()
      registeredRef.current = registeredRef.current || res.ok
      setRegMsg(res.ok
        ? (res.updated ? 'Счёт в реестре обновлён: сумма и плательщик — как в заказе' : 'Счёт зарегистрирован — виден в «Счета B2B»')
        : (res.error || 'Не удалось зарегистрировать'))
    } finally { setRegLoading(false) }
  }

  // Регистрация при печати/скачивании — один раз на загрузку. Ошибка реестра не
  // мешает печатать документ, но говорится: иначе счёт молча не попадал в дебиторку.
  async function ensureRegistered() {
    if (registeredRef.current || !order) return
    registeredRef.current = true
    const res = await postInvoice()
    if (!res.ok) {
      registeredRef.current = false
      toast.error('Счёт не попал в реестр счетов', { detail: `${res.error ?? 'Неизвестная ошибка'}. Печать не остановлена — повторите кнопкой «📒 В реестр счетов».` })
    }
  }

  // А8: ссылка на оплату для клиента (в буфер обмена). Пока эквайринг не подключён —
  // роут честно отвечает 501, и менеджер видит, чего не хватает.
  const [payLoading, setPayLoading] = useState(false)
  const [payMsg, setPayMsg] = useState<string | null>(null)
  async function payLink() {
    setPayLoading(true); setPayMsg(null)
    try {
      const r = await fetch(`/api/b2b-quotes/${id}/pay-link`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setPayMsg(j.error || 'Не удалось получить ссылку'); return }
      try {
        await navigator.clipboard.writeText(j.url)
        setPayMsg(`Ссылка на оплату ${Math.round(j.amount).toLocaleString('ru-RU')} ₽ скопирована`)
      } catch {
        await promptDialog({ title: 'Ссылка на оплату', text: 'Скопировать автоматически не получилось — выделите ссылку и скопируйте.', defaultValue: j.url, confirmLabel: 'Готово' })
      }
    } finally { setPayLoading(false) }
  }

  // Сохранить юрлицо к клиенту. Ответ сервера проверяем: раньше отказ был молчаливым,
  // и менеджер уходил с уверенностью, что реквизиты записаны.
  async function saveEntity(entity: Requisites, failTitle: string): Promise<boolean> {
    let r: Response
    try {
      r = await fetch(`/api/quotes/${id}/invoice-data`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity: { id: selectedEntityId ?? undefined, ...entity } }),
      })
    } catch { toast.error(failTitle, { detail: NETWORK_ERROR }); return false }
    if (!r.ok) { toast.error(failTitle, { detail: await responseError(r) }); return false }
    const j = await r.json().catch(() => ({})) as { entity_id?: number }
    setSaved(true); setTimeout(() => setSaved(false), 1800)
    await refreshEntities(j.entity_id ?? selectedEntityId)
    return true
  }

  async function save() {
    setSaving(true); setSaved(false)
    try { await saveEntity(req, 'Юрлицо не сохранено') } finally { setSaving(false) }
  }

  // Выбор юрлица покупателя для этого счёта; «new» — добавить новое (не затирая старые).
  function selectEntity(val: string) {
    if (val === 'new') { setSelectedEntityId(null); setReq(EMPTY); return }
    const e = entities.find(x => x.id === Number(val))
    if (e) { setSelectedEntityId(e.id); setReq(toReq(e)) }
  }

  function applyCustomer(c: Record<string, string | undefined>) {
    setReq(prev => ({
      ...prev,
      full_name: c.name || c.fio || prev.full_name,
      inn: c.inn || prev.inn, kpp: c.kpp || prev.kpp, ogrn: c.ogrn || prev.ogrn,
      legal_address: c.legal_address || c.address || prev.legal_address,
      bank_account: c.account || prev.bank_account, bank_name: c.bank || prev.bank_name,
      bik: c.bik || prev.bik, corr_account: c.corr_account || prev.corr_account,
    }))
  }

  async function aiParse() {
    if (!parseText.trim()) return
    setParsing(true)
    try {
      const r = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: parseText }),
      })
      if (!r.ok) { toast.error('Реквизиты не распознаны', { detail: await responseError(r) }); return }
      const j = await r.json().catch(() => ({})) as { customer?: Record<string, string | undefined> }
      if (j.customer) applyCustomer(j.customer)
      else toast.error('Реквизиты не распознаны', { detail: 'В тексте не нашлось ИНН или названия' })
    } catch {
      toast.error('Реквизиты не распознаны', { detail: NETWORK_ERROR })
    } finally { setParsing(false) }
  }

  // Карточка предприятия файлом (PDF/фото): разбор → поля → автосохранение к клиенту,
  // дальше все счета по этому клиенту заполняются сами.
  async function parseCardFile(file: File) {
    setParsing(true)
    try {
      const readB64 = (f: Blob) => new Promise<string>((res, rej) => {
        const rd = new FileReader()
        rd.onload = () => res(String(rd.result).split(',')[1] || '')
        rd.onerror = rej
        rd.readAsDataURL(f)
      })
      let payload: Record<string, string>
      if (file.type === 'application/pdf') payload = { pdf: await readB64(file) }
      else {
        const url = URL.createObjectURL(file)
        try {
          const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
          const MAX = 2000
          const scale = Math.min(1, MAX / Math.max(img.width, img.height))
          if (scale >= 1 && file.size < 2_500_000) payload = { image: await readB64(file), image_type: file.type }
          else {
            const c = document.createElement('canvas')
            c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale)
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
            payload = { image: c.toDataURL('image/jpeg', 0.85).split(',')[1] || '', image_type: 'image/jpeg' }
          }
        } finally { URL.revokeObjectURL(url) }
      }
      const pr = await fetch('/api/ai/parse-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!pr.ok) { toast.error('Карточка не распознана', { detail: await responseError(pr) }); return }
      const r = await pr.json().catch(() => ({})) as { customer?: Record<string, string | undefined> }
      if (!r.customer) { toast.error('Карточка не распознана', { detail: 'В файле не нашлось реквизитов' }); return }
      applyCustomer(r.customer)
      // сразу привязываем к карточке клиента
      const c = r.customer
      const merged = {
        ...req,
        full_name: c.name || c.fio || req.full_name,
        inn: c.inn || req.inn, kpp: c.kpp || req.kpp, ogrn: c.ogrn || req.ogrn,
        legal_address: c.legal_address || c.address || req.legal_address,
        bank_account: c.account || req.bank_account, bank_name: c.bank || req.bank_name,
        bik: c.bik || req.bik, corr_account: c.corr_account || req.corr_account,
      }
      setSaving(true)
      try { await saveEntity(merged, 'Реквизиты распознаны, но не сохранены к клиенту') } finally { setSaving(false) }
    } catch (e) {
      toast.error('Карточка не распознана', { detail: e instanceof Error ? e.message : NETWORK_ERROR })
    } finally { setParsing(false) }
  }

  async function downloadPdf() {
    if (!docRef.current) return
    void ensureRegistered()   // печать = документ выдан → в реестр
    try {
      // Снимок при десктопной ширине (renderDocCanvas) → PDF одинаков с телефона и ПК.
      const jspdf = await import('jspdf')
      const canvas = await renderDocCanvas(docRef.current)
      const pdf = new jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
      const pw = 210, ph = 297
      const imgH = pw * canvas.height / canvas.width
      let pos = 0, left = imgH
      const img = canvas.toDataURL('image/jpeg', 0.94)
      // многостраничность, если контент длиннее A4
      pdf.addImage(img, 'JPEG', 0, pos, pw, imgH)
      left -= ph
      while (left > 0) { pos -= ph; pdf.addPage(); pdf.addImage(img, 'JPEG', 0, pos, pw, imgH); left -= ph }
      pdf.save(`Счёт-спецификация-${order?.custom_number?.trim() || String(order?.id ?? '').padStart(5, '0')}.pdf`)
    } catch (e) {
      toast.error('Не удалось сформировать PDF', {
        detail: (e instanceof Error ? e.message : 'неизвестная ошибка') + '. Лист можно сохранить через «Печать» → Сохранить как PDF.',
        action: { label: 'Печать', onClick: () => window.print() },
      })
    }
  }

  if (loading) return <DocSkeleton rows={7} />
  if (error || !order) return <div className="flex items-center justify-center min-h-screen text-red-500 text-sm">{error ?? 'Ошибка загрузки'}</div>

  const reqMissing = !req.inn

  return (
    <>
      <style>{'body{background:#ececea}'}</style>

      {/* Toolbar + requisites editor — screen only */}
      <div className="no-print max-w-[820px] mx-auto pt-6 px-4 flex flex-wrap items-center gap-2">
        <button onClick={downloadPdf} className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg hover:bg-[#2a2a28]">⬇ Скачать PDF</button>
        <button onClick={() => { void ensureRegistered(); document.fonts.ready.then(() => window.print()) }} className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white">🖨 Печать</button>
        {/* А7: УПД по этому же заказу — реквизиты берутся отсюда же */}
        <a href={`/b2b-quotes/${id}/upd`} target="_blank" rel="noreferrer"
          className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white">📑 УПД</a>
        {/* А8: ссылка на онлайн-оплату — общий провайдер с кабинетом партнёра */}
        <button onClick={payLink} disabled={payLoading}
          className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white disabled:opacity-40">
          {payLoading ? '…' : '💳 Ссылка на оплату'}
        </button>
        {payMsg && <span className="text-[12px] text-[#6b6b66] max-w-[420px]">{payMsg}</span>}
        {/* А10: реестр счетов */}
        <button onClick={registerInvoice} disabled={regLoading}
          className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white disabled:opacity-40">
          {regLoading ? '…' : '📒 В реестр счетов'}
        </button>
        {regMsg && <span className="text-[12px] text-[#6b6b66] max-w-[420px]">{regMsg}</span>}
        <button onClick={() => setShowEditor(v => !v)} className="border border-[#d4d4cf] text-[#333] text-[13px] px-4 py-2 rounded-lg hover:bg-white ml-auto">{showEditor ? 'Скрыть реквизиты' : 'Реквизиты покупателя'}</button>
      </div>

      {showEditor && (
        <div className="no-print max-w-[820px] mx-auto mt-3 px-4">
          <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[13px] font-bold text-[#111110]">Реквизиты покупателя (для счёта)</h3>
              {reqMissing && <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded">заполните — ИНН, банк, счёт</span>}
            </div>
            {entities.length > 0 && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] text-[#9a9a95] whitespace-nowrap">Юрлицо покупателя:</span>
                <select value={selectedEntityId ?? 'new'} onChange={e => selectEntity(e.target.value)}
                  className="flex-1 border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110] bg-white">
                  {entities.map(e => <option key={e.id} value={e.id}>{entityTitle(e)}{e.is_default ? ' · основное' : ''}</option>)}
                  <option value="new">＋ Новое юрлицо…</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {([
                ['full_name', 'Полное наименование'], ['inn', 'ИНН'], ['kpp', 'КПП'],
                ['ogrn', 'ОГРН / ОГРНИП'], ['legal_address', 'Юр. адрес'], ['bank_name', 'Банк'],
                ['bank_account', 'Р/С'], ['bik', 'БИК'], ['corr_account', 'К/С'],
                ['supply_contract_no', 'Договор поставки №'],
              ] as [keyof Requisites, string][]).map(([k, label]) => (
                <label key={k} className={`flex flex-col gap-0.5 ${k === 'full_name' || k === 'legal_address' ? 'col-span-2 md:col-span-3' : ''}`}>
                  <span className="text-[10px] uppercase tracking-wide text-[#9a9a95]">{label}</span>
                  <input value={req[k]} onChange={e => setReq(p => ({ ...p, [k]: e.target.value }))}
                    className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]" />
                </label>
              ))}
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wide text-[#9a9a95]">Дата договора</span>
                <input type="date" value={req.supply_contract_date} onChange={e => setReq(p => ({ ...p, supply_contract_date: e.target.value }))}
                  className="border border-[#e4e4e0] rounded-lg px-2 py-1 text-[12px] outline-none focus:border-[#111110]" />
              </label>
            </div>

            <div className="mt-3 flex flex-col md:flex-row gap-2">
              <textarea value={parseText} onChange={e => setParseText(e.target.value)} rows={2}
                placeholder="Вставьте реквизиты из карточки клиента одним куском — распознаю автоматически"
                className="flex-1 border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-[12px] outline-none focus:border-[#111110] resize-none" />
              <div className="flex md:flex-col gap-2">
                <button onClick={aiParse} disabled={parsing || !parseText.trim()}
                  className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#333] hover:bg-[#f5f5f4] disabled:opacity-40 whitespace-nowrap">
                  {parsing ? '…' : '🤖 Распознать'}
                </button>
                <label className={`text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#333] hover:bg-[#f5f5f4] whitespace-nowrap text-center ${parsing ? 'opacity-40 cursor-default' : 'cursor-pointer'}`}>
                  {parsing ? '…' : '📎 Карточка (PDF/фото)'}
                  <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={parsing}
                    onChange={e => { const f = e.target.files?.[0]; if (f) parseCardFile(f); e.target.value = '' }} />
                </label>
                <button onClick={save} disabled={saving}
                  className="text-[12px] px-3 py-1.5 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">
                  {saving ? '…' : saved ? '✓ Сохранено' : selectedEntityId ? '💾 Сохранить юрлицо' : '💾 Добавить юрлицо'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Документ — единый компонент InvoiceDocument (тот же в кабинете партнёра) */}
      <InvoiceDocument ref={docRef} order={order} requisites={req} buyerName={buyerName} />
    </>
  )
}
