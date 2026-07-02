'use client'

import { useEffect, useState } from 'react'
import { PageHeader, SegmentedTabs, MetricTile, EmptyState, Field, SelectField } from '@/components/ds'

type Partner = {
  id: number
  name: string
  type: string
  phone: string | null
  email: string | null
  company: string | null
  instagram: string | null
  commission_percent: number
  status: string
  notes: string | null
  marketing_partner_referrals?: Referral[]
}

type Referral = {
  id: number
  partner_id: number
  client_name: string | null
  client_phone: string | null
  product: string | null
  order_amount: number | null
  commission_amount: number | null
  status: string
  order_date: string | null
  paid_at: string | null
  notes: string | null
}

type Tab = 'partners' | 'referrals'

const TYPES = [
  { v: 'designer', l: '🎨 Дизайнер' },
  { v: 'foreman',  l: '🔨 Прораб' },
  { v: 'builder',  l: '🏗️ Строительная компания' },
  { v: 'furniture',l: '🪑 Мебельщик' },
  { v: 'other',    l: '👤 Другое' },
]

const REF_STATUSES = [
  { v: 'pending',   l: 'В работе',  cls: 'bg-blue-100 text-blue-700' },
  { v: 'completed', l: 'Завершено', cls: 'bg-emerald-100 text-emerald-700' },
  { v: 'paid',      l: '✓ Выплачено',cls: 'bg-slate-100 text-slate-700' },
  { v: 'cancelled', l: 'Отменено',  cls: 'bg-red-50 text-red-500' },
]

const EMPTY_P: Omit<Partner, 'id' | 'marketing_partner_referrals'> = {
  name: '', type: 'designer', phone: '', email: '', company: '', instagram: '', commission_percent: 5, status: 'active', notes: '',
}
const EMPTY_R: Omit<Referral, 'id'> = {
  partner_id: 0, client_name: '', client_phone: '', product: '', order_amount: null, commission_amount: null, status: 'pending', order_date: null, paid_at: null, notes: '',
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('partners')
  const [selectedPartner, setSelectedPartner] = useState<Partner | null>(null)
  const [formP, setFormP] = useState<Omit<Partner, 'id' | 'marketing_partner_referrals'>>(EMPTY_P)
  const [formR, setFormR] = useState<Omit<Referral, 'id'>>(EMPTY_R)
  const [editPId, setEditPId] = useState<number | null>(null)
  const [editRId, setEditRId] = useState<number | null>(null)
  const [showFormP, setShowFormP] = useState(false)
  const [showFormR, setShowFormR] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const res = await fetch('/api/marketing/partners?referrals=1')
    const data: Partner[] = res.ok ? await res.json() : []
    setPartners(data)
    if (selectedPartner) {
      setSelectedPartner(data.find(p => p.id === selectedPartner.id) ?? null)
    }
    setLoading(false)
  }

  const totalSales = (p: Partner) => p.marketing_partner_referrals?.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.order_amount ?? 0), 0) ?? 0
  const totalComm  = (p: Partner) => p.marketing_partner_referrals?.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.commission_amount ?? 0), 0) ?? 0
  const unpaidComm = (p: Partner) => p.marketing_partner_referrals?.filter(r => r.status === 'completed').reduce((s, r) => s + (r.commission_amount ?? 0), 0) ?? 0

  async function savePartner() {
    if (!formP.name.trim()) return
    setSaving(true)
    const method = editPId ? 'PUT' : 'POST'
    const body = editPId ? { id: editPId, ...formP } : formP
    await fetch('/api/marketing/partners', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setShowFormP(false)
    load()
  }

  async function saveReferral() {
    if (!formR.partner_id) return
    setSaving(true)
    const commission = formR.order_amount && selectedPartner
      ? Math.round(formR.order_amount * selectedPartner.commission_percent / 100)
      : formR.commission_amount
    const body = editRId
      ? { id: editRId, _type: 'referral', ...formR, commission_amount: commission }
      : { _type: 'referral', ...formR, commission_amount: commission }
    await fetch('/api/marketing/partners', { method: editRId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    setShowFormR(false)
    load()
  }

  async function advanceRef(r: Referral) {
    const order = REF_STATUSES.map(s => s.v)
    const idx = order.indexOf(r.status)
    if (idx >= order.length - 1) return
    await fetch('/api/marketing/partners', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, _type: 'referral', status: order[idx + 1] }) })
    load()
  }

  const allRefs = partners.flatMap(p => (p.marketing_partner_referrals ?? []).map(r => ({ ...r, _partner: p })))

  if (loading) return <div className="min-h-screen flex items-center justify-center text-[13px] text-muted">Загрузка...</div>

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">

      <PageHeader
        title="Partner Center"
        subtitle={`${partners.filter(p => p.status === 'active').length} активных партнёров`}
        actions={
          <button onClick={() => { setFormP(EMPTY_P); setEditPId(null); setShowFormP(true) }}
            className="flex-shrink-0 px-4 py-2 bg-ink text-white rounded-xl text-[13px] font-medium hover:bg-[#2a2a28] transition-colors">
            + Партнёр
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <MetricTile
          label="Всего продаж"
          value={`${allRefs.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.order_amount ?? 0), 0).toLocaleString('ru-RU')} ₽`}
        />
        <MetricTile
          label="К выплате"
          value={<span className="text-amber-600">{partners.reduce((s, p) => s + unpaidComm(p), 0).toLocaleString('ru-RU')} ₽</span>}
        />
        <MetricTile
          label="Выплачено всего"
          value={`${allRefs.filter(r => r.status === 'paid').reduce((s, r) => s + (r.commission_amount ?? 0), 0).toLocaleString('ru-RU')} ₽`}
        />
      </div>

      {/* Tabs */}
      <div className="mb-5">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[{ value: 'partners', label: 'Партнёры' }, { value: 'referrals', label: 'Рефералы' }]}
        />
      </div>

      {tab === 'partners' && (
        <div className="space-y-3">
          {partners.length === 0 && <EmptyState title="Нет партнёров" hint="Добавьте первого." />}
          {partners.map(p => (
            <div key={p.id} className="bg-surface border border-line rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[14px] font-semibold text-ink">{p.name}</span>
                    <span className="text-[11px] bg-line-soft text-ink-soft px-2 py-0.5 rounded-full">
                      {TYPES.find(t => t.v === p.type)?.l ?? p.type}
                    </span>
                    <span className="text-[11px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium tabular-nums">{p.commission_percent}%</span>
                    {unpaidComm(p) > 0 && (
                      <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full font-medium tabular-nums">К выплате: {unpaidComm(p).toLocaleString('ru-RU')} ₽</span>
                    )}
                  </div>
                  <div className="flex gap-4 text-[12px] text-ink-soft">
                    {p.phone && <span>{p.phone}</span>}
                    {p.company && <span>{p.company}</span>}
                    {p.instagram && <span>@{p.instagram}</span>}
                  </div>
                  <div className="mt-2 flex gap-4 text-[12px]">
                    <span className="text-ink-soft">Заявок: <strong className="tabular-nums">{(p.marketing_partner_referrals ?? []).length}</strong></span>
                    <span className="text-ink-soft">Продажи: <strong className="tabular-nums">{totalSales(p).toLocaleString('ru-RU')} ₽</strong></span>
                    <span className="text-ink-soft">Вознаграждение: <strong className="tabular-nums">{totalComm(p).toLocaleString('ru-RU')} ₽</strong></span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => { setSelectedPartner(p); setFormR({ ...EMPTY_R, partner_id: p.id }); setEditRId(null); setShowFormR(true) }}
                    className="text-[12px] px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors">+ Реферал</button>
                  <button onClick={() => { const { id, marketing_partner_referrals, ...rest } = p; setFormP(rest); setEditPId(id); setShowFormP(true) }}
                    className="text-[12px] px-3 py-1.5 rounded-lg border border-line text-ink-soft hover:bg-subtle transition-colors">Ред.</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'referrals' && (
        <div className="space-y-2">
          {allRefs.length === 0 && <EmptyState title="Нет рефералов" />}
          {allRefs.map(r => {
            const sc = REF_STATUSES.find(s => s.v === r.status) ?? { l: r.status, cls: 'bg-slate-100 text-slate-600' }
            return (
              <div key={r.id} className="bg-surface border border-line rounded-xl p-3 flex items-center gap-3">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${sc.cls}`}>{sc.l}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-ink">{r.client_name ?? 'Клиент'}</span>
                  {r.client_phone && <span className="text-[12px] text-muted ml-2">{r.client_phone}</span>}
                  {r.product && <span className="text-[12px] text-ink-soft ml-2">· {r.product}</span>}
                </div>
                <div className="flex gap-3 text-[12px] flex-shrink-0">
                  {r.order_amount && <span className="text-ink font-medium tabular-nums">{r.order_amount.toLocaleString('ru-RU')} ₽</span>}
                  {r.commission_amount && <span className="text-amber-600 font-medium tabular-nums">→ {r.commission_amount.toLocaleString('ru-RU')} ₽</span>}
                  <span className="text-muted">{(r as unknown as { _partner: Partner })._partner?.name}</span>
                </div>
                <button onClick={() => advanceRef(r)}
                  className="text-[11px] px-2.5 py-1 rounded-lg border border-line text-ink-soft hover:bg-subtle transition-colors">→</button>
              </div>
            )
          })}
        </div>
      )}

      {/* Partner form */}
      {showFormP && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-[16px] font-semibold text-ink mb-5">{editPId ? 'Редактировать партнёра' : 'Новый партнёр'}</h2>
            <div className="space-y-3">
              {[
                { k: 'name', l: 'Имя / Название *', pl: 'Анна Иванова' },
                { k: 'company', l: 'Компания', pl: 'Студия дизайна' },
                { k: 'phone', l: 'Телефон', pl: '+7 900 000 00 00' },
                { k: 'email', l: 'Email', pl: 'anna@design.ru' },
                { k: 'instagram', l: 'Instagram', pl: 'anna.design' },
              ].map(({ k, l, pl }) => (
                <div key={k}>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">{l}</label>
                  <Field type="text" value={(formP as Record<string, string | number | null>)[k] as string ?? ''}
                    onChange={e => setFormP(f => ({ ...f, [k]: e.target.value }))} placeholder={pl}
                    className="w-full" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Тип</label>
                  <SelectField value={formP.type} onChange={e => setFormP(f => ({ ...f, type: e.target.value }))} className="w-full">
                    {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </SelectField>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Комиссия %</label>
                  <Field type="number" value={formP.commission_percent}
                    onChange={e => setFormP(f => ({ ...f, commission_percent: Number(e.target.value) }))}
                    className="w-full" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={savePartner} disabled={saving}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-medium disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowFormP(false)}
                className="px-5 py-2 border border-line rounded-xl text-[13px] text-ink-soft hover:bg-canvas transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}

      {/* Referral form */}
      {showFormR && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-[16px] font-semibold text-ink mb-2">Новая реферальная заявка</h2>
            {selectedPartner && <p className="text-[13px] text-ink-soft mb-5">Партнёр: <strong>{selectedPartner.name}</strong> · {selectedPartner.commission_percent}%</p>}
            <div className="space-y-3">
              {[
                { k: 'client_name', l: 'Имя клиента', pl: 'Иван Петров' },
                { k: 'client_phone', l: 'Телефон клиента', pl: '+7 900 000 00 00' },
                { k: 'product', l: 'Продукт', pl: 'Душевая перегородка M7' },
              ].map(({ k, l, pl }) => (
                <div key={k}>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">{l}</label>
                  <Field type="text" value={(formR as Record<string, unknown>)[k] as string ?? ''}
                    onChange={e => setFormR(f => ({ ...f, [k]: e.target.value }))} placeholder={pl}
                    className="w-full" />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">Сумма заказа ₽</label>
                  <Field type="number" value={formR.order_amount ?? ''}
                    onChange={e => setFormR(f => ({ ...f, order_amount: e.target.value ? Number(e.target.value) : null }))}
                    className="w-full" />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink-soft mb-1">
                    Вознаграждение ₽
                    {formR.order_amount && selectedPartner && (
                      <span className="font-normal text-muted ml-1">(авто: {Math.round(formR.order_amount * selectedPartner.commission_percent / 100).toLocaleString('ru-RU')})</span>
                    )}
                  </label>
                  <Field type="number" value={formR.commission_amount ?? ''}
                    onChange={e => setFormR(f => ({ ...f, commission_amount: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="Авторасчёт"
                    className="w-full" />
                </div>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-ink-soft mb-1">Дата заказа</label>
                <input type="date" value={formR.order_date ?? ''}
                  onChange={e => setFormR(f => ({ ...f, order_date: e.target.value || null }))}
                  className="w-full border border-line rounded-lg px-3 py-2 text-[12px]" />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button onClick={saveReferral} disabled={saving}
                className="px-5 py-2 bg-ink text-white rounded-xl text-[13px] font-medium disabled:opacity-50 transition-colors">
                {saving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button onClick={() => setShowFormR(false)}
                className="px-5 py-2 border border-line rounded-xl text-[13px] text-ink-soft hover:bg-canvas transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
