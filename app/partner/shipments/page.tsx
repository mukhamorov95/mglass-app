'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadJson } from '@/lib/toast'
import { presetPeriod, type PresetId } from '@/lib/b2b/clientReport'
import type { ReconDoc } from '@/lib/production/clientReconciliation'
import ReconciliationDoc, { fmtMoney } from '@/app/production-app/shower-glass/ReconciliationDoc'
import { fmtDay, fmtKg } from '@/app/production-app/shower-glass/types'
import type { PartnerShipOrder, PartnerShipment } from '@/lib/partner/shipmentsView'

// «Отгрузки» кабинета (К7, владелец 24.11): то же, что видит наш цех на экране Шовер Гласс —
// в работе, упакованы, отгружены, просроченные, срочно отгрузить, история отгрузок и акт сверки.
// Только чтение.

type Data = { available: boolean; today: string; money: boolean; finance: boolean; orders: PartnerShipOrder[]; shipments: PartnerShipment[] }
type Tab = 'in_work' | 'packed' | 'shipped' | 'overdue' | 'urgent' | 'shipments' | 'recon'

const TABS: { key: Exclude<Tab, 'shipments' | 'recon'>; label: string; empty: string }[] = [
  { key: 'in_work', label: 'В работе', empty: 'Заказов в работе нет.' },
  { key: 'packed', label: 'Упакованы', empty: 'Упакованных заказов нет.' },
  { key: 'shipped', label: 'Отгружены', empty: 'Отгруженных заказов нет.' },
  { key: 'overdue', label: 'Просроченные', empty: 'Просроченных заказов нет.' },
  { key: 'urgent', label: 'Срочно отгрузить', empty: 'Срочных заказов нет.' },
]

function inTab(o: PartnerShipOrder, t: Tab): boolean {
  if (t === 'overdue') return o.overdue_days > 0
  if (t === 'urgent') return o.urgent
  return o.stage === t
}

function sorted(list: PartnerShipOrder[], t: Tab): PartnerShipOrder[] {
  if (t === 'urgent') return [...list].sort((a, b) => (a.urgent_rank ?? 1e9) - (b.urgent_rank ?? 1e9))
  if (t === 'shipped') return [...list].sort((a, b) => (b.ship_day ?? '').localeCompare(a.ship_day ?? '') || b.id - a.id)
  return [...list].sort((a, b) => b.overdue_days - a.overdue_days || a.launch_day.localeCompare(b.launch_day) || a.id - b.id)
}

export default function PartnerShipmentsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('in_work')

  useEffect(() => {
    loadJson<Data>('/api/partner/shipments').then(r => { if (r.error !== null) setErr(r.error); else setData(r.data) })
  }, [])

  const counts = useMemo(() => {
    const out: Record<string, number> = {}
    for (const t of TABS) out[t.key] = data?.orders.filter(o => inTab(o, t.key)).length ?? 0
    return out
  }, [data])

  const btn = (t: Tab, label: string, alarm = false) => (
    <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t} className={tab === t ? 'primary' : 'ghost'}
      style={{ padding: '7px 12px', fontSize: 13, ...(alarm && tab !== t ? { color: 'var(--red, #c0392b)', borderColor: 'currentColor' } : {}) }}>
      {label}
    </button>
  )

  return (
    <div className="wrap">
      <div className="ph" style={{ marginBottom: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Отгрузки</h1>
        <div className="cap">Где каждый заказ: в работе, упакован, уехал. Отгрузки по датам и акт сверки.</div>
      </div>

      {err && <div className="note"><div className="t">Не загрузилось</div><div className="s">{err}. Обновите страницу через минуту.</div></div>}
      {!err && !data && <div className="note"><div className="s">Загрузка…</div></div>}
      {data && !data.available && <div className="note"><div className="s">Учёт отгрузок по изделиям для вашей компании пока не ведётся. Статусы заказов — в «Заказах в работе».</div></div>}

      {data?.available && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {TABS.map(t => btn(t.key, `${t.label} · ${counts[t.key]}`, (t.key === 'overdue' || t.key === 'urgent') && counts[t.key] > 0))}
            {btn('shipments', `История отгрузок · ${data.shipments.length}`)}
            {data.finance && btn('recon', 'Акт сверки')}
          </div>

          {TABS.some(t => t.key === tab) && (() => {
            const list = sorted(data.orders.filter(o => inTab(o, tab)), tab)
            if (list.length === 0) return <div className="note"><div className="s">{TABS.find(t => t.key === tab)!.empty}</div></div>
            return <div style={{ display: 'grid', gap: 10 }}>{list.map(o => <OrderBox key={o.id} o={o} money={data.money} urgentTab={tab === 'urgent'} />)}</div>
          })()}

          {tab === 'shipments' && <ShipmentsList list={data.shipments} money={data.money} />}
          {tab === 'recon' && data.finance && <Recon today={data.today} />}
        </>
      )}
    </div>
  )
}

const STAGE_RU = { in_work: 'в работе', packed: 'упакован', shipped: 'отгружен' } as const

function OrderBox({ o, money, urgentTab }: { o: PartnerShipOrder; money: boolean; urgentTab: boolean }) {
  const [open, setOpen] = useState(urgentTab)
  const pieces = o.lines.reduce((n, l) => n + l.qty, 0)
  const shipped = o.lines.reduce((n, l) => n + l.shipped, 0)
  const sum = money ? o.lines.reduce((n, l) => n + (l.amount ?? 0), 0) : null
  return (
    <div className="ord" style={{ cursor: 'default' }}>
      <div className="r1">
        <div>
          <div className="num">{o.no}{o.client_no && <span className="yr"> · ваш № {o.client_no}</span>}{o.urgent && <span className="pill p-ship" style={{ marginLeft: 8 }}>срочно</span>}</div>
          <div className="meta">
            запущен {fmtDay(o.launch_day)}{o.deadline_day ? ` · срок ${fmtDay(o.deadline_day)}` : ''}
            {o.overdue_days > 0 ? ` · просрочен на ${o.overdue_days} дн.` : ''}
            {o.ship_day ? ` · отгружен ${fmtDay(o.ship_day)}` : ''}
          </div>
          <div className="meta tnum" style={{ marginTop: 2 }}>
            {STAGE_RU[o.stage]} · упаковано позиций {o.packed_lines} из {o.lines.length} · уехало {shipped} из {pieces} шт.
          </div>
        </div>
        {sum !== null && <div className="amt tnum">{fmtMoney(sum)}</div>}
      </div>
      <button className="ghost" style={{ marginTop: 8, fontSize: 12, padding: '4px 10px' }} onClick={() => setOpen(v => !v)}>
        {open ? 'Скрыть изделия ▴' : `Изделия · ${o.lines.length} ▾`}
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
          {o.lines.map(l => (
            <div key={l.key} className="meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
              <span style={{ flex: '1 1 220px', minWidth: 0, color: 'var(--ink)' }}>{l.label}{l.size ? ` · ${l.size}` : ''} · {l.qty} шт.</span>
              <span className="tnum">{l.shipped >= l.qty ? 'уехало' : l.shipped > 0 ? `уехало ${l.shipped} из ${l.qty}` : l.packed ? 'упаковано' : 'в работе'}</span>
              {l.left && l.left.length > 0 && <span style={{ flexBasis: '100%' }}>осталось: {l.left.join(', ')}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ShipmentsList({ list, money }: { list: PartnerShipment[]; money: boolean }) {
  const [open, setOpen] = useState<number | null>(null)
  if (list.length === 0) return <div className="note"><div className="s">Отгрузок пока нет.</div></div>
  const sorted = [...list].sort((a, b) => (b.ship_date ?? '').localeCompare(a.ship_date ?? '') || b.id - a.id)
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {sorted.map(h => {
        const pieces = h.lines.reduce((n, l) => n + l.qty, 0)
        const weight = h.lines.reduce((n, l) => n + l.weight, 0)
        const sum = money ? h.lines.reduce((n, l) => n + (l.own_cost ? 0 : (l.amount ?? 0)), 0) : null
        const orders = new Set(h.lines.map(l => l.order_id)).size
        return (
          <div key={h.id} className="ord" style={{ cursor: 'default' }}>
            <div className="r1">
              <div>
                <div className="num">Отгрузка {fmtDay(h.ship_date)}</div>
                <div className="meta tnum">заказов {orders} · {pieces} шт. · {fmtKg(weight)}</div>
              </div>
              {sum !== null && <div className="amt tnum">{fmtMoney(sum)}</div>}
            </div>
            <button className="ghost" style={{ marginTop: 8, fontSize: 12, padding: '4px 10px' }} onClick={() => setOpen(open === h.id ? null : h.id)}>
              {open === h.id ? 'Скрыть ▴' : 'Что уехало ▾'}
            </button>
            {open === h.id && (
              <div style={{ display: 'grid', gap: 4, marginTop: 8 }}>
                {h.lines.map((l, i) => (
                  <div key={i} className="meta" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
                    <span style={{ minWidth: 70, color: 'var(--ink)' }}>{l.order_no}{l.client_no ? ` (ваш № ${l.client_no})` : ''}</span>
                    <span style={{ flex: '1 1 200px', minWidth: 0 }}>{l.label}{l.size ? ` · ${l.size}` : ''} · {l.qty} шт.</span>
                    {money && <span className="tnum">{l.own_cost ? 'за наш счёт' : fmtMoney(l.amount ?? 0)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'month', label: 'Этот месяц' }, { id: 'prev_month', label: 'Прошлый месяц' }, { id: 'quarter', label: 'Квартал' }, { id: 'year', label: 'Год' },
]
type HistoryRow = { id: number; date_from: string; date_to: string; created_at: string; closing_items: string | null }
// Знак как в акте: плюс — должны мы, минус — должен клиент. Здесь читает клиент.
const partnerDebt = (n: number) => (n === 0 ? 'взаиморасчёты закрыты' : n > 0 ? `M-Glass должен вам ${fmtMoney(n)}` : `вы должны ${fmtMoney(-n)}`)
type ReconData = { today: string; doc: ReconDoc; history: HistoryRow[] }

function Recon({ today }: { today: string }) {
  const [period, setPeriod] = useState(() => presetPeriod('month', today))
  const [data, setData] = useState<ReconData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<{ id: number; doc: ReconDoc; created_at: string } | null>(null)

  const fetchDoc = useCallback(() => loadJson<ReconData>(`/api/partner/reconciliation?from=${period.from}&to=${period.to}`), [period])
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchDoc>>) => { if (r.error !== null) setError(r.error); else { setError(null); setData(r.data) } }, [])
  useEffect(() => { fetchDoc().then(apply) }, [fetchDoc, apply])
  const load = () => fetchDoc().then(apply)

  async function openSaved(id: number) {
    const r = await loadJson<{ id: number; snapshot: ReconDoc; created_at: string }>(`/api/partner/reconciliation?id=${id}`)
    if (r.error !== null) { setError(r.error); return }
    setSaved({ id: r.data.id, doc: r.data.snapshot, created_at: r.data.created_at })
  }

  const ready = data && data.doc.from === period.from && data.doc.to === period.to
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {PRESETS.map(p => {
            const v = presetPeriod(p.id, today)
            const on = v.from === period.from && v.to === period.to && !saved
            return <button key={p.id} className={on ? 'primary' : 'ghost'} style={{ padding: '6px 10px', fontSize: 13 }} onClick={() => { setSaved(null); setPeriod(v) }}>{p.label}</button>
          })}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <label>С <input type="date" value={period.from} max={period.to} onChange={e => { setSaved(null); if (e.target.value) setPeriod(p => ({ ...p, from: e.target.value })) }} /></label>
          <label>по <input type="date" value={period.to} min={period.from} onChange={e => { setSaved(null); if (e.target.value) setPeriod(p => ({ ...p, to: e.target.value })) }} /></label>
        </div>
      </div>

      {error && <div className="perr">Не удалось посчитать: {error}. <button className="ghost" onClick={() => void load()}>Повторить</button></div>}

      {data && data.history.length > 0 && (
        <div style={{ display: 'grid', gap: 6 }}>
          <div className="lane-lbl">Подписанные нами акты <span className="n">{data.history.length}</span></div>
          {data.history.map(h => (
            <button key={h.id} className="ghost" style={{ textAlign: 'left', display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13 }} onClick={() => void openSaved(h.id)}>
              <b>№ {h.id}, {fmtDay(h.date_from)} — {fmtDay(h.date_to)}</b>
              {h.closing_items != null && <span>{partnerDebt(Number(h.closing_items))}</span>}
              <span className="meta">от {fmtDay(h.created_at.slice(0, 10))}</span>
            </button>
          ))}
        </div>
      )}

      {saved ? (
        <div style={{ background: '#fff', color: '#111110', borderRadius: 12, padding: 16 }}>
          <button className="ghost" style={{ marginBottom: 10 }} onClick={() => setSaved(null)}>← К расчёту за период</button>
          <ReconciliationDoc doc={saved.doc} caption={`Акт № ${saved.id}, сохранён ${fmtDay(saved.created_at.slice(0, 10))}.`} />
        </div>
      ) : ready ? (
        <div style={{ background: '#fff', color: '#111110', borderRadius: 12, padding: 16 }}>
          <ReconciliationDoc doc={data.doc} caption="Расчёт на сейчас по данным M-Glass." />
        </div>
      ) : !error && <div className="meta">Считаю…</div>}
    </div>
  )
}
