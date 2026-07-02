'use client'

import { useEffect, useState, useMemo } from 'react'

type SupplierStatus = 'active' | 'inactive' | 'paused' | 'problem'

type Supplier = {
  id:              string
  name:            string
  contact:         string | null
  phone:           string | null
  email:           string | null
  whatsapp:        string | null
  telegram:        string | null
  address:         string | null
  city:            string | null
  work_hours:      string | null
  materials:       string | null
  type:            string | null
  supplier_type:   string | null
  notes:           string | null
  active:          boolean
  has_vat:         boolean
  status:          SupplierStatus
  priority:        number
  lead_time_days:  number | null
  updated_at:      string | null
}

type FormState = Omit<Supplier, 'id' | 'updated_at'>

const LEGACY_TYPES = ['стекло', 'зеркало', 'фурнитура', 'LED', 'упаковка', 'профиль', 'расходники', 'логистика', 'прочее']

const SUPPLIER_TYPES = [
  { value: 'glass_mirror',      label: 'Стекло и зеркала' },
  { value: 'hardware',          label: 'Фурнитура' },
  { value: 'lighting',          label: 'Свет / электрика' },
  { value: 'consumables',       label: 'Расходники производства' },
  { value: 'external_services', label: 'Внешние услуги' },
  { value: 'logistics',         label: 'Логистика' },
  { value: 'other',             label: 'Другое' },
] as const

function supplierTypeLabel(value?: string | null): string {
  return SUPPLIER_TYPES.find((t) => t.value === value)?.label ?? 'Другое'
}

const STATUS_META: Record<SupplierStatus, { label: string; cls: string }> = {
  active:   { label: 'Активный',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  inactive: { label: 'Неактивный',  cls: 'bg-gray-100   text-gray-500   border-gray-200'    },
  paused:   { label: 'На паузе',    cls: 'bg-amber-50   text-amber-700  border-amber-200'   },
  problem:  { label: 'Проблемный',  cls: 'bg-red-50     text-red-700    border-red-200'     },
}

const PRIORITY_META: Record<number, { label: string; cls: string }> = {
  1: { label: 'Высокий',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  2: { label: 'Средний',  cls: 'bg-gray-50 text-gray-500 border-gray-200' },
  3: { label: 'Низкий',   cls: 'bg-gray-50 text-gray-400 border-gray-200' },
}

const EMPTY: FormState = {
  name: '', contact: '', phone: '', email: '', whatsapp: '', telegram: '',
  address: '', city: '', work_hours: '', materials: '', type: '', supplier_type: 'other',
  notes: '', active: true, has_vat: true, status: 'active', priority: 2, lead_time_days: null,
}

export default function SuppliersPage() {
  const [suppliers, setSuppliers]   = useState<Supplier[]>([])
  const [loading, setLoading]       = useState(true)
  const [modal, setModal]           = useState<'none' | 'create' | 'edit' | 'detail'>('none')
  const [selected, setSelected]     = useState<Supplier | null>(null)
  const [form, setForm]             = useState<FormState>(EMPTY)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [toast, setToast]           = useState<string | null>(null)

  // filters
  const [search,         setSearch]         = useState('')
  const [filterStatus,   setFilterStatus]   = useState<SupplierStatus | 'all'>('all')
  const [filterType,     setFilterType]     = useState<string>('all')

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res  = await fetch('/api/admin/suppliers')
    const data = await res.json()
    setSuppliers(res.ok ? data : [])
    setLoading(false)
  }

  function openCreate() {
    setForm(EMPTY)
    setError('')
    setModal('create')
  }

  function openEdit(s: Supplier, e?: React.MouseEvent) {
    e?.stopPropagation()
    setSelected(s)
    setForm({
      name: s.name, contact: s.contact ?? '', phone: s.phone ?? '', email: s.email ?? '',
      whatsapp: s.whatsapp ?? '', telegram: s.telegram ?? '', address: s.address ?? '',
      city: s.city ?? '', work_hours: s.work_hours ?? '', materials: s.materials ?? '',
      type: s.type ?? '', supplier_type: s.supplier_type ?? 'other',
      notes: s.notes ?? '', active: s.active, has_vat: s.has_vat,
      status: s.status, priority: s.priority, lead_time_days: s.lead_time_days,
    })
    setError('')
    setModal('edit')
  }

  function openDetail(s: Supplier) {
    setSelected(s)
    setModal('detail')
  }

  async function save() {
    if (!form.name.trim()) { setError('Название обязательно'); return }
    setSaving(true); setError('')
    const isEdit = modal === 'edit' && selected

    const res = await fetch(
      isEdit ? `/api/admin/suppliers/${selected.id}` : '/api/admin/suppliers',
      {
        method:  isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ...(isEdit ? { id: selected.id } : {}), ...form }),
      }
    )
    const data = await res.json()
    if (!res.ok) { setError(data.error ?? 'Ошибка'); setSaving(false); return }

    if (isEdit) {
      setSuppliers(prev => prev.map(s => s.id === selected.id ? { ...s, ...data } : s))
      showToast('Поставщик обновлён')
    } else {
      setSuppliers(prev => [data, ...prev])
      showToast('Поставщик добавлен')
    }
    setModal('none')
    setSaving(false)
  }

  async function toggleStatus(s: Supplier, status: SupplierStatus, e: React.MouseEvent) {
    e.stopPropagation()
    const res = await fetch(`/api/admin/suppliers/${s.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ status, active: status === 'active' }),
    })
    if (res.ok) {
      const updated = await res.json()
      setSuppliers(prev => prev.map(x => x.id === s.id ? { ...x, ...updated } : x))
    }
  }

  const visible = useMemo(() => {
    return suppliers.filter(s => {
      if (filterStatus !== 'all' && s.status !== filterStatus) return false
      if (filterType !== 'all' && (s.supplier_type ?? 'other') !== filterType) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const haystack = [s.name, s.contact, s.phone, s.city, s.materials, s.type].join(' ').toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [suppliers, filterStatus, filterType, search])

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: suppliers.length }
    for (const s of suppliers) { c[s.status] = (c[s.status] ?? 0) + 1 }
    return c
  }, [suppliers])

  const inp = 'w-full border border-line rounded-lg px-3 py-2 text-[12px] outline-none focus:border-ink bg-surface'

  return (
    <div className="min-h-screen bg-canvas">
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-ink text-white text-[12px] px-4 py-2.5 rounded-xl shadow-lg">
          {toast}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[18px] font-semibold text-ink">Поставщики</h1>
            <p className="text-[12px] text-muted mt-0.5">Централизованная база снабжения MGlass</p>
          </div>
          <button onClick={openCreate}
            className="px-4 py-2 bg-ink text-white text-[13px] font-medium rounded-lg hover:bg-[#2a2a28] transition-colors">
            + Добавить поставщика
          </button>
        </div>

        {/* Status filter pills */}
        <div className="flex gap-2 flex-wrap">
          {([
            { key: 'all',      label: `Все (${counts.all ?? 0})` },
            { key: 'active',   label: `Активные (${counts.active ?? 0})` },
            { key: 'paused',   label: `На паузе (${counts.paused ?? 0})` },
            { key: 'problem',  label: `Проблемные (${counts.problem ?? 0})` },
            { key: 'inactive', label: `Неактивные (${counts.inactive ?? 0})` },
          ] as const).map(f => (
            <button key={f.key}
              onClick={() => setFilterStatus(f.key)}
              className={`text-[11px] font-medium px-3 py-1.5 rounded-full border transition-colors ${filterStatus === f.key ? 'bg-ink text-white border-ink' : 'bg-surface text-ink-soft border-line hover:border-ink'}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Search + type filter */}
        <div className="flex gap-2">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по названию, телефону, городу, категории..."
            className="flex-1 border border-line rounded-lg px-3 py-2 text-[12px] outline-none focus:border-ink bg-surface"
          />
          <select
            value={filterType} onChange={e => setFilterType(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-[12px] outline-none focus:border-ink bg-surface">
            <option value="all">Все типы</option>
            {SUPPLIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        {/* List */}
        {loading ? (
          <p className="text-center py-12 text-[13px] text-muted">Загрузка...</p>
        ) : visible.length === 0 ? (
          <div className="bg-surface border border-line rounded-xl p-12 text-center">
            <p className="text-[13px] text-muted">Поставщики не найдены</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(s => {
              const sm = STATUS_META[s.status] ?? STATUS_META.inactive
              const pm = PRIORITY_META[s.priority] ?? PRIORITY_META[2]
              return (
                <div key={s.id}
                  onClick={() => openDetail(s)}
                  className="bg-surface border border-line rounded-xl px-5 py-4 cursor-pointer hover:border-ink transition-colors group">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <p className="text-[14px] font-semibold text-ink">{s.name}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${sm.cls}`}>{sm.label}</span>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{supplierTypeLabel(s.supplier_type)}</span>
                        {s.priority === 1 && (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${pm.cls}`}>★ {pm.label}</span>
                        )}
                        {!s.has_vat && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">без НДС</span>
                        )}
                      </div>
                      <div className="flex gap-4 flex-wrap">
                        {s.city     && <span className="text-[11px] text-muted">📍 {s.city}</span>}
                        {s.contact  && <span className="text-[11px] text-muted">👤 {s.contact}</span>}
                        {s.phone    && <span className="text-[11px] text-muted">📞 {s.phone}</span>}
                        {s.telegram && <span className="text-[11px] text-muted">✈️ {s.telegram}</span>}
                        {s.work_hours && <span className="text-[11px] text-muted">🕐 {s.work_hours}</span>}
                        {s.lead_time_days && <span className="text-[11px] text-muted tabular-nums">⏱ {s.lead_time_days} дн.</span>}
                      </div>
                      {s.materials && (
                        <p className="text-[11px] text-ink-soft mt-1">{s.materials}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={e => openEdit(s, e)}
                        className="px-3 py-1.5 text-[11px] border border-line rounded-lg text-ink-soft hover:bg-canvas">
                        Изменить
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {(modal === 'create' || modal === 'edit') && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[16px] font-semibold text-ink">
                {modal === 'create' ? '+ Новый поставщик' : 'Редактировать поставщика'}
              </h2>
              <button onClick={() => setModal('none')} className="text-muted hover:text-ink text-xl">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Название *</Label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className={inp} placeholder="ООО Поставщик" />
              </div>

              <div>
                <Label>Тип поставщика</Label>
                <select value={form.supplier_type ?? 'other'} onChange={e => setForm(f => ({...f, supplier_type: e.target.value}))} className={inp}>
                  {SUPPLIER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>

              <div>
                <Label>Тип поставок (детали)</Label>
                <select value={form.type ?? ''} onChange={e => setForm(f => ({...f, type: e.target.value}))} className={inp}>
                  <option value="">— выбери —</option>
                  {LEGACY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div>
                <Label>Статус</Label>
                <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value as SupplierStatus}))} className={inp}>
                  <option value="active">Активный</option>
                  <option value="paused">На паузе</option>
                  <option value="problem">Проблемный</option>
                  <option value="inactive">Неактивный</option>
                </select>
              </div>

              <div>
                <Label>Контактное лицо</Label>
                <input value={form.contact ?? ''} onChange={e => setForm(f => ({...f, contact: e.target.value}))} className={inp} />
              </div>
              <div>
                <Label>Телефон</Label>
                <input value={form.phone ?? ''} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className={inp} placeholder="+7 (999) 000-00-00" />
              </div>
              <div>
                <Label>WhatsApp</Label>
                <input value={form.whatsapp ?? ''} onChange={e => setForm(f => ({...f, whatsapp: e.target.value}))} className={inp} placeholder="+7 ..." />
              </div>
              <div>
                <Label>Telegram</Label>
                <input value={form.telegram ?? ''} onChange={e => setForm(f => ({...f, telegram: e.target.value}))} className={inp} placeholder="@username" />
              </div>
              <div>
                <Label>Email</Label>
                <input value={form.email ?? ''} onChange={e => setForm(f => ({...f, email: e.target.value}))} className={inp} />
              </div>
              <div>
                <Label>Город</Label>
                <input value={form.city ?? ''} onChange={e => setForm(f => ({...f, city: e.target.value}))} className={inp} placeholder="Москва" />
              </div>
              <div className="col-span-2">
                <Label>Адрес склада</Label>
                <input value={form.address ?? ''} onChange={e => setForm(f => ({...f, address: e.target.value}))} className={inp} />
              </div>
              <div>
                <Label>График работы</Label>
                <input value={form.work_hours ?? ''} onChange={e => setForm(f => ({...f, work_hours: e.target.value}))} className={inp} placeholder="Пн-Пт 9:00–18:00" />
              </div>
              <div>
                <Label>Срок поставки (дни)</Label>
                <input type="number" min="1" value={form.lead_time_days ?? ''} onChange={e => setForm(f => ({...f, lead_time_days: e.target.value ? Number(e.target.value) : null}))} className={inp} placeholder="3" />
              </div>
              <div className="col-span-2">
                <Label>Категория материалов</Label>
                <input value={form.materials ?? ''} onChange={e => setForm(f => ({...f, materials: e.target.value}))} className={inp} placeholder="Зеркало, профиль, фурнитура..." />
              </div>
              <div>
                <Label>Приоритет</Label>
                <select value={form.priority} onChange={e => setForm(f => ({...f, priority: Number(e.target.value)}))} className={inp}>
                  <option value={1}>★ Высокий</option>
                  <option value={2}>Средний</option>
                  <option value={3}>Низкий</option>
                </select>
              </div>
              <div className="flex flex-col gap-2 pt-5">
                <label className="flex items-center gap-2 text-[12px] text-ink-soft cursor-pointer">
                  <input type="checkbox" checked={form.has_vat} onChange={e => setForm(f => ({...f, has_vat: e.target.checked}))} className="rounded" />
                  Работает с НДС
                </label>
              </div>
              <div className="col-span-2">
                <Label>Комментарий</Label>
                <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={3} className={inp + ' resize-none'} />
              </div>
            </div>

            {error && <p className="text-[12px] text-red-600">{error}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={save} disabled={saving}
                className="flex-1 py-2.5 bg-ink text-white text-[13px] font-semibold rounded-lg disabled:opacity-40 hover:bg-[#2a2a28] transition-colors">
                {saving ? 'Сохраняю...' : modal === 'create' ? 'Добавить поставщика' : 'Сохранить изменения'}
              </button>
              <button onClick={() => setModal('none')}
                className="px-4 py-2.5 border border-line text-[13px] text-ink-soft rounded-lg hover:bg-canvas">
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {modal === 'detail' && selected && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 overflow-y-auto py-8 px-4">
          <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold text-ink">{selected.name}</h2>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${STATUS_META[selected.status]?.cls ?? ''}`}>
                    {STATUS_META[selected.status]?.label}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{supplierTypeLabel(selected.supplier_type)}</span>
                  {!selected.has_vat && (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">без НДС</span>
                  )}
                </div>
              </div>
              <button onClick={() => setModal('none')} className="text-muted hover:text-ink text-xl flex-shrink-0">×</button>
            </div>

            <div className="space-y-2 text-[12px]">
              {selected.contact    && <Row label="Контакт"    value={selected.contact} />}
              {selected.phone      && <Row label="Телефон"    value={selected.phone} />}
              {selected.whatsapp   && <Row label="WhatsApp"   value={selected.whatsapp} />}
              {selected.telegram   && <Row label="Telegram"   value={selected.telegram} />}
              {selected.email      && <Row label="Email"      value={selected.email} />}
              {selected.city       && <Row label="Город"      value={selected.city} />}
              {selected.address    && <Row label="Адрес"      value={selected.address} />}
              {selected.work_hours && <Row label="Режим"      value={selected.work_hours} />}
              {selected.lead_time_days && <Row label="Срок поставки" value={`${selected.lead_time_days} дн.`} />}
              {selected.materials  && <Row label="Материалы"  value={selected.materials} />}
              {selected.notes      && <Row label="Заметка"    value={selected.notes} />}
            </div>

            <div>
              <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-2">Изменить статус</p>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(STATUS_META) as SupplierStatus[]).map(st => (
                  <button key={st}
                    onClick={e => { toggleStatus(selected, st, e); setSelected({ ...selected, status: st }); }}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors ${selected.status === st ? STATUS_META[st].cls : 'bg-surface text-muted border-line hover:border-ink'}`}>
                    {STATUS_META[st].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => openEdit(selected)}
                className="flex-1 py-2 bg-ink text-white text-[12px] font-semibold rounded-lg hover:bg-[#2a2a28]">
                Редактировать
              </button>
              <button onClick={() => setModal('none')}
                className="px-4 py-2 border border-line text-[12px] text-ink-soft rounded-lg hover:bg-canvas">
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1">{children}</p>
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="text-muted w-28 flex-shrink-0">{label}</span>
      <span className="text-ink break-all">{value}</span>
    </div>
  )
}
