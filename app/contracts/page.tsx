'use client'

import { useEffect, useState } from 'react'
import { PRODUCT_DEADLINES, deadlineFor, type ProductKind } from '@/lib/contractDeadlines'

type Customer = Record<string, string>
type Spec = { name: string; desc?: string; dimensions?: string; qty?: string }
type Form = {
  number: string; date: string; date_iso: string
  kp_id: number | null
  customer_type: 'individual' | 'company'
  customer: Customer
  spec: Spec[]
  total: string; make_sum: string; install_sum: string; prepayment: string
  product_kind: ProductKind; make_days: number; install_days: number
}
const SERVICE_RE = /монтаж|демонтаж|доставк|подъ[её]м|замер|выезд/i
type KpRow = { id: number; number: string; total: number | null; content: Record<string, unknown> }
type HistRow = { id: number; number: string; customer_type: string; total: number | null; manager_name: string | null; created_at: string; content: Record<string, unknown> }

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь']
const pad = (n: number) => String(n).padStart(2, '0')
const today = () => new Date()
const fmtDate = (d: Date) => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const numOr = (v: string | number | undefined) => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')); return isFinite(n) ? n : 0 }
const RUB = (v: string | number | undefined) => numOr(v).toLocaleString('ru-RU')

function emptyForm(): Form {
  const d = today()
  return {
    number: '', date: fmtDate(d), date_iso: isoDate(d), kp_id: null,
    customer_type: 'individual', customer: {}, spec: [],
    total: '', make_sum: '', install_sum: '', prepayment: '',
    product_kind: 'mirror', make_days: 15, install_days: 5,
  }
}

const L = 'block text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest mb-1'
const I = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white'

const INDIV_FIELDS: [keyof Customer & string, string][] = [
  ['fio', 'ФИО'], ['passport_series', 'Серия'], ['passport_number', 'Номер'],
  ['passport_issued_by', 'Кем выдан'], ['passport_issued_date', 'Дата выдачи'], ['passport_code', 'Код подразделения'],
  ['address', 'Адрес регистрации'], ['phone', 'Телефон'],
]
const COMP_FIELDS: [string, string][] = [
  ['name', 'Наименование'], ['director', 'В лице (директор)'], ['inn', 'ИНН'], ['kpp', 'КПП'], ['ogrn', 'ОГРН'],
  ['legal_address', 'Юр. адрес'], ['actual_address', 'Факт. адрес'], ['account', 'Р/С'], ['bank', 'Банк'],
  ['bik', 'БИК'], ['corr_account', 'К/С'], ['phone', 'Телефон'], ['email', 'Email'],
]

export default function ContractsPage() {
  const [tab, setTab] = useState<'new' | 'history'>('new')
  const [form, setForm] = useState<Form>(emptyForm())
  const [editingId, setEditingId] = useState<number | null>(null)
  const [savedId, setSavedId] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [kps, setKps] = useState<KpRow[]>([])
  const [history, setHistory] = useState<HistRow[]>([])
  const [canDelete, setCanDelete] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const set = (patch: Partial<Form>) => { setForm(f => ({ ...f, ...patch })); setSavedId(null) }
  const setCust = (k: string, v: string) => { setForm(f => ({ ...f, customer: { ...f.customer, [k]: v } })); setSavedId(null) }

  useEffect(() => { fetch('/api/kp').then(r => r.json()).then(d => setKps(Array.isArray(d.items) ? d.items : [])).catch(() => {}) }, [])
  useEffect(() => { if (tab === 'history') loadHistory() }, [tab])

  async function loadHistory() {
    try {
      const d = await fetch('/api/contracts').then(r => r.json())
      setHistory(Array.isArray(d.items) ? d.items : [])
      setCanDelete(!!d.canDelete)
      const n = today(); setExpanded(new Set([`${n.getFullYear()}-${n.getMonth()}`]))
    } catch { setHistory([]) }
  }

  function pickKp(id: number) {
    const kp = kps.find(k => k.id === id)
    if (!kp) { set({ kp_id: null }); return }
    const content = kp.content || {}
    const items = Array.isArray(content.items) ? content.items as Record<string, unknown>[] : []
    // Спецификация договора — только изделия (без монтажа/доставки), с описанием.
    const goods = items.filter(it => !SERVICE_RE.test(String(it.name ?? '')))
    const spec: Spec[] = goods.map(it => ({
      name: String(it.name ?? ''), desc: String(it.desc ?? ''), qty: it.qty != null ? String(it.qty) : '1',
    }))
    const total = kp.total != null ? numOr(kp.total) : numOr(content.total as string)
    // Авто-разбивка: монтаж/доставка → монтаж, остальное → изготовление.
    const installSum = items.filter(it => SERVICE_RE.test(String(it.name ?? '')))
      .reduce((s, it) => s + numOr((it.sum ?? it.price) as number), 0)
    const makeSum = Math.max(0, total - installSum)
    setForm(f => ({
      ...f, kp_id: id, spec, total: String(total),
      make_sum: installSum ? String(makeSum) : f.make_sum,
      install_sum: installSum ? String(installSum) : f.install_sum,
      prepayment: f.prepayment || String(total),
    }))
    setSavedId(null)
  }

  function pickKind(kind: ProductKind) {
    const d = deadlineFor(kind)
    set({ product_kind: kind, make_days: d.make, install_days: d.install })
  }

  const addSpec = () => set({ spec: [...form.spec, { name: '', qty: '1' }] })
  const updSpec = (i: number, p: Partial<Spec>) => setForm(f => { const s = f.spec.slice(); s[i] = { ...s[i], ...p }; return { ...f, spec: s } })
  const rmSpec = (i: number) => set({ spec: form.spec.filter((_, j) => j !== i) })

  async function save() {
    setSaving(true); setSaveError(null)
    try {
      const content = { ...form }
      const method = editingId ? 'PATCH' : 'POST'
      const body = editingId ? { id: editingId, content } : { content }
      const res = await fetch('/api/contracts', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const id = editingId ?? data.id
        setEditingId(id); setSavedId(id)
        if (data.number && !form.number) setForm(f => ({ ...f, number: data.number }))
      } else setSaveError(data.error || `Ошибка ${res.status}`)
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Ошибка сети') } finally { setSaving(false) }
  }

  function editRow(r: HistRow) {
    const c = r.content as Partial<Form>
    setForm({ ...emptyForm(), ...c, customer: c.customer ?? {}, spec: c.spec ?? [], number: r.number })
    setEditingId(r.id); setSavedId(null); setTab('new')
  }
  function newDoc() { setForm(emptyForm()); setEditingId(null); setSavedId(null); setTab('new') }

  async function del(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Удалить договор безвозвратно?')) return
    const res = await fetch('/api/contracts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (res.ok) setHistory(prev => prev.filter(r => r.id !== id))
  }

  const groups = (() => {
    const m = new Map<string, { label: string; rows: HistRow[] }>()
    for (const r of history) {
      const d = new Date(r.created_at); const key = `${d.getFullYear()}-${d.getMonth()}`
      if (!m.has(key)) m.set(key, { label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, rows: [] })
      m.get(key)!.rows.push(r)
    }
    return [...m.entries()]
  })()

  const custFields = form.customer_type === 'company' ? COMP_FIELDS : INDIV_FIELDS

  // Предоплата/остаток: предоплата уходит на изготовление, затем на монтаж.
  const totalN = numOr(form.total), makeN = numOr(form.make_sum), installN = numOr(form.install_sum)
  const prepay = form.prepayment === '' ? totalN : numOr(form.prepayment)
  const rem = {
    total: Math.max(0, totalN - prepay),
    make: Math.max(0, makeN - prepay),
    install: Math.max(0, installN - Math.max(0, prepay - makeN)),
  }

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-[18px] font-semibold text-[#111110]">Договор и счёт</h1>
            <p className="text-[12px] text-[#9a9a95] mt-0.5">Выберите КП, заполните заказчика — договор и счёт соберутся автоматически</p>
          </div>
          <div className="flex gap-1 bg-white border border-[#e4e4e0] rounded-lg p-1">
            <button onClick={newDoc} className={`px-3 py-1.5 text-[13px] font-medium rounded-md ${tab === 'new' ? 'bg-[#111110] text-white' : 'text-[#6b6b66]'}`}>Новый</button>
            <button onClick={() => setTab('history')} className={`px-3 py-1.5 text-[13px] font-medium rounded-md ${tab === 'history' ? 'bg-[#111110] text-white' : 'text-[#6b6b66]'}`}>История</button>
          </div>
        </div>

        {tab === 'new' ? (
          <div className="space-y-4">
            {/* КП + header */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 grid grid-cols-3 gap-3">
              <div className="col-span-3"><label className={L}>Коммерческое предложение (КП)</label>
                <select className={I} value={form.kp_id ?? ''} onChange={e => pickKp(e.target.value ? Number(e.target.value) : 0)}>
                  <option value="">— выберите КП —</option>
                  {kps.map(k => <option key={k.id} value={k.id}>№ {k.number} · {RUB(k.total ?? 0)} ₽</option>)}
                </select>
              </div>
              <div><label className={L}>Номер договора</label><input className={I} value={form.number} onChange={e => set({ number: e.target.value })} placeholder="авто" /></div>
              <div><label className={L}>Дата</label><input className={I} value={form.date} onChange={e => set({ date: e.target.value })} /></div>
              <div><label className={L}>Изделие → срок</label>
                <select className={I} value={form.product_kind} onChange={e => pickKind(e.target.value as ProductKind)}>
                  {Object.entries(PRODUCT_DEADLINES).map(([k, v]) => <option key={k} value={k}>{v.label} ({v.make}+{v.install})</option>)}
                </select>
              </div>
              <div className="col-span-3 text-[12px] text-[#6b6b66]">Срок по договору: <b>{form.make_days} раб. дн.</b> изготовление + <b>{form.install_days} раб. дн.</b> монтаж = <b>{form.make_days + form.install_days} раб. дн.</b></div>
            </div>

            {/* Customer */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[13px] font-semibold text-[#111110]">Заказчик</span>
                <div className="flex gap-1 bg-[#f0f0ec] rounded-lg p-0.5">
                  <button onClick={() => set({ customer_type: 'individual' })} className={`px-3 py-1 text-[12px] rounded-md ${form.customer_type === 'individual' ? 'bg-white shadow-sm font-medium' : 'text-[#9a9a95]'}`}>Физлицо</button>
                  <button onClick={() => set({ customer_type: 'company' })} className={`px-3 py-1 text-[12px] rounded-md ${form.customer_type === 'company' ? 'bg-white shadow-sm font-medium' : 'text-[#9a9a95]'}`}>Юрлицо</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {custFields.map(([k, lbl]) => (
                  <div key={k} className={k === 'passport_issued_by' || k === 'address' || k === 'name' || k === 'legal_address' || k === 'actual_address' ? 'col-span-2' : ''}>
                    <label className={L}>{lbl}</label>
                    <input className={I} value={form.customer[k] ?? ''} onChange={e => setCust(k, e.target.value)} />
                  </div>
                ))}
              </div>
            </div>

            {/* Spec */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#111110]">Спецификация (из КП)</span>
                <button onClick={addSpec} className="text-[12px] text-[#E1442E] font-medium">+ позиция</button>
              </div>
              <div className="space-y-2">
                {form.spec.map((s, i) => (
                  <div key={i} className="border border-[#f0f0ec] rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] text-[#9a9a95] w-8">2.{i + 1}</span>
                      <input className={`${I} flex-1`} value={s.name} onChange={e => updSpec(i, { name: e.target.value })} placeholder="Изделие" />
                      <input className={`${I} w-40`} value={s.dimensions ?? ''} onChange={e => updSpec(i, { dimensions: e.target.value })} placeholder="Размеры" />
                      <input className={`${I} w-16`} value={s.qty ?? ''} onChange={e => updSpec(i, { qty: e.target.value })} placeholder="шт" />
                      <button onClick={() => rmSpec(i)} className="px-2 text-[#c4c4be] hover:text-red-500">✕</button>
                    </div>
                    <input className={`${I} w-full`} value={s.desc ?? ''} onChange={e => updSpec(i, { desc: e.target.value })} placeholder="Описание: стекло, толщина, обработка, фурнитура…" />
                  </div>
                ))}
                {!form.spec.length && <p className="text-[12px] text-[#9a9a95]">Выберите КП сверху — позиции подтянутся, или добавьте вручную.</p>}
              </div>
            </div>

            {/* Финансы и оплата */}
            <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[13px] font-semibold text-[#111110] mb-3">Финансы и оплата</p>
              <div className="grid grid-cols-3 gap-3">
                <div><label className={L}>Общая сумма договора, ₽</label><input className={I} value={form.total} onChange={e => set({ total: e.target.value })} /></div>
                <div><label className={L}>Изготовление, ₽</label><input className={I} value={form.make_sum} onChange={e => set({ make_sum: e.target.value })} placeholder="вручную" /></div>
                <div><label className={L}>Монтаж, ₽</label><input className={I} value={form.install_sum} onChange={e => set({ install_sum: e.target.value })} placeholder="вручную" /></div>
                <div><label className={L}>Предоплата, ₽</label><input className={I} value={form.prepayment} onChange={e => set({ prepayment: e.target.value })} placeholder="пусто = 100%" /></div>
                <div className="col-span-2"><label className={L}>Остаток</label>
                  <div className="px-3 py-2 text-[13px] bg-[#f5f5f3] rounded-lg border border-[#e4e4e0] font-semibold text-[#111110]">{RUB(rem.total)} ₽</div>
                </div>
              </div>
              <div className="mt-2.5 text-[12px] text-[#6b6b66] leading-relaxed">
                {rem.total > 0 ? (
                  <>Предоплата <b>{RUB(prepay)} ₽</b> — для запуска изготовления.{' '}
                  Остаток за изготовление <b>{RUB(rem.make)} ₽</b> — по готовности, до монтажа.{' '}
                  Остаток за монтаж <b>{RUB(rem.install)} ₽</b> — после монтажа. НДС 5% включён.</>
                ) : <>Оплата 100% — единый авансовый платёж. НДС 5% включён.</>}
              </div>
            </div>

            {/* actions */}
            <div className="flex items-center gap-3 sticky bottom-4">
              <button onClick={save} disabled={saving || (!form.total && !form.spec.length)}
                className="px-5 py-2.5 bg-[#111110] text-white text-[13px] font-semibold rounded-lg hover:bg-[#2a2a28] disabled:opacity-50 shadow-lg">
                {saving ? 'Сохранение…' : editingId ? 'Сохранить изменения' : 'Сохранить'}
              </button>
              {savedId && (
                <a href={`/contracts/${savedId}/print`} target="_blank" rel="noreferrer"
                  className="px-5 py-2.5 bg-[#E1442E] text-white text-[13px] font-semibold rounded-lg hover:bg-[#c93a26] shadow-lg">
                  📄 Договор и счёт (PDF)
                </a>
              )}
              {savedId && <span className="text-[12px] text-emerald-600">Сохранено ✓</span>}
              {saveError && <span className="text-[12px] text-red-600">Не сохранилось: {saveError}</span>}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {!history.length && <div className="bg-white border border-[#e4e4e0] rounded-xl p-8 text-center text-[13px] text-[#9a9a95]">Пока нет договоров.</div>}
            {groups.map(([key, g]) => {
              const open = expanded.has(key)
              return (
                <div key={key} className="bg-white border border-[#e4e4e0] rounded-xl overflow-hidden">
                  <button onClick={() => setExpanded(p => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#fafaf9]">
                    <span className="flex items-center gap-2"><span className="text-[11px] text-[#6b6b66] w-3">{open ? '▼' : '▶'}</span>
                      <span className="text-[14px] font-semibold text-[#111110]">{g.label}</span>
                      <span className="text-[11px] text-[#9a9a95]">· {g.rows.length}</span></span>
                  </button>
                  {open && (
                    <div className="divide-y divide-[#f5f5f3] border-t border-[#f0f0ec]">
                      {g.rows.map(r => (
                        <div key={r.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-[#fafaf9]">
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[#111110] truncate">Договор № {r.number} · {r.customer_type === 'company' ? 'юрлицо' : 'физлицо'}</p>
                            <p className="text-[11px] text-[#9a9a95]">{r.manager_name ?? ''} · {new Date(r.created_at).toLocaleDateString('ru-RU')}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className="text-[13px] font-semibold text-[#111110]">{RUB(r.total ?? 0)} ₽</span>
                            <button onClick={() => editRow(r)} className="text-[12px] text-[#6b6b66] hover:text-[#111110]">✏️</button>
                            <a href={`/contracts/${r.id}/print`} target="_blank" rel="noreferrer" className="text-[12px] text-[#E1442E] font-medium">PDF</a>
                            {canDelete && <button onClick={e => del(r.id, e)} className="text-[12px] text-red-400 hover:text-red-600" title="Удалить (только админ)">🗑</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
