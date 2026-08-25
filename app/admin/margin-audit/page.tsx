'use client'

import { useCallback, useEffect, useState } from 'react'

type Cause = 'missing_cost' | 'low_list_price' | 'manager_discount' | 'ok'

type AuditOrder = {
  id: number; createdAt: string; clientId: number | null; clientName: string; managerName: string | null
  discountPercent: number; revenueNet: number; costNet: number
  marginActual: number | null; marginList: number | null
  color: 'red' | 'amber' | 'green' | 'unknown'; cause: Cause
  gapFromPricePts: number; gapFromDiscountPts: number; undersoldNet: number; missingCostPositions: number
}

type Report = {
  orders: AuditOrder[]; totalUndersoldNet: number; belowTarget: number; scanned: number
  byCause: { cause: Cause; count: number; undersoldNet: number }[]
  byManager: { managerName: string; belowTarget: number; undersoldNet: number; avgMargin: number | null; total: number }[]
  byClient: { clientId: number | null; clientName: string; belowTarget: number; undersoldNet: number }[]
  thresholds: { target: number; green: number; yellow: number }
  from: string; to: string
}

const CAUSE_LABEL: Record<Cause, string> = {
  missing_cost: 'Позиции без себестоимости',
  low_list_price: 'Низкая цена продажи',
  manager_discount: 'Скидка менеджера',
  ok: 'В норме',
}
const CAUSE_STYLE: Record<Cause, string> = {
  missing_cost: 'bg-red-50 text-red-700 border-red-200',
  low_list_price: 'bg-amber-50 text-amber-700 border-amber-200',
  manager_discount: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  ok: 'bg-[#f5f5f3] text-[#6b6b66] border-[#e4e4e0]',
}
const MARGIN_TEXT: Record<AuditOrder['color'], string> = {
  red: 'text-red-600', amber: 'text-amber-600', green: 'text-emerald-600', unknown: 'text-[#9a9a95]',
}

const CARD = 'bg-white border border-[#e4e4e0] rounded-xl'
const money = (v: number) => Math.round(v).toLocaleString('ru-RU')
const pctv = (v: number | null) => v == null ? '—' : `${v}%`
const dateRu = (s: string) => new Date(s).toLocaleDateString('ru-RU')

export default function MarginAuditPage() {
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async (f?: string, t?: string) => {
    setLoading(true); setError(null)
    const qs = f && t ? `?from=${f}&to=${t}` : ''
    const res = await fetch(`/api/admin/margin-audit${qs}`)
    if (!res.ok) {
      setError(res.status === 403 ? 'Нет доступа — раздел только для владельца и закупщика' : 'Не удалось загрузить отчёт')
      setReport(null); setLoading(false); return
    }
    const data: Report = await res.json()
    setReport(data); setFrom(data.from); setTo(data.to); setLoading(false)
  }, [])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  return (
    <div className="p-6 max-w-[1400px]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-[#111110] tracking-tight">Аудит маржи по просчётам</h1>
          <p className="text-[13px] text-[#8a8a85] mt-0.5 max-w-[820px]">
            Где просчёт ушёл клиенту с реальной, но низкой маржой — и почему. Отсортировано по деньгам:
            сколько недозаработали до целевой маржи{report ? ` ${report.thresholds.target}%` : ''}, а не по проценту.
          </p>
        </div>
        <div className="flex items-end gap-2 flex-shrink-0">
          <label className="text-[12px] text-[#6b6b66]">С
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="mt-1 block border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px]" />
          </label>
          <label className="text-[12px] text-[#6b6b66]">По
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="mt-1 block border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px]" />
          </label>
          <button onClick={() => load(from, to)}
            className="text-[12px] font-medium px-3.5 py-2 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
            Показать
          </button>
        </div>
      </div>

      {loading ? (
        <div className={`${CARD} py-12 text-center text-[13px] text-[#8a8a85]`}>Считаю…</div>
      ) : error ? (
        <div className={`${CARD} py-12 text-center text-[13px] text-red-600`}>{error}</div>
      ) : !report ? null : (
        <>
          <div className="grid grid-cols-4 gap-3 mb-5">
            <Stat label="Просчётов за период" value={String(report.scanned)} />
            <Stat label={`Ниже цели ${report.thresholds.target}%`} value={String(report.belowTarget)} accent={report.belowTarget > 0 ? 'red' : 'green'} />
            <Stat label="Недозаработок, ₽ без НДС" value={money(report.totalUndersoldNet)} accent={report.totalUndersoldNet > 0 ? 'red' : 'green'} />
            <Stat label="Порог: красная / жёлтая" value={`< ${report.thresholds.yellow}% / < ${report.thresholds.green}%`} />
          </div>

          {report.byCause.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-5">
              {report.byCause.map(c => (
                <div key={c.cause} className={`${CARD} p-4`}>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${CAUSE_STYLE[c.cause]}`}>{CAUSE_LABEL[c.cause]}</span>
                  <div className="mt-2 text-[18px] font-semibold text-[#111110]">{money(c.undersoldNet)} ₽</div>
                  <div className="text-[12px] text-[#9a9a95]">{c.count} {c.count === 1 ? 'просчёт' : 'просчётов'}</div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 mb-5">
            <AggTable title="Менеджеры в низкой марже" empty="Все в пределах цели">
              <thead className="bg-[#faf9f7] text-[11px] text-[#6b6b66]">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Менеджер</th>
                  <th className="text-right font-medium px-3 py-2">Ниже цели</th>
                  <th className="text-right font-medium px-3 py-2">Ср. маржа</th>
                  <th className="text-right font-medium px-3 py-2">Недозаработок ₽</th>
                </tr>
              </thead>
              <tbody>
                {report.byManager.map(m => (
                  <tr key={m.managerName} className="border-t border-[#f0f0ec]">
                    <td className="px-3 py-1.5 text-[#111110]">{m.managerName}</td>
                    <td className="px-3 py-1.5 text-right text-[#6b6b66]">{m.belowTarget} из {m.total}</td>
                    <td className="px-3 py-1.5 text-right text-[#6b6b66]">{pctv(m.avgMargin)}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-[#111110]">{money(m.undersoldNet)}</td>
                  </tr>
                ))}
              </tbody>
            </AggTable>

            <AggTable title="Клиенты, по которым уходим в низкую маржу" empty="Нет">
              <thead className="bg-[#faf9f7] text-[11px] text-[#6b6b66]">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Клиент</th>
                  <th className="text-right font-medium px-3 py-2">Просчётов ниже цели</th>
                  <th className="text-right font-medium px-3 py-2">Недозаработок ₽</th>
                </tr>
              </thead>
              <tbody>
                {report.byClient.map(c => (
                  <tr key={`${c.clientId}|${c.clientName}`} className="border-t border-[#f0f0ec]">
                    <td className="px-3 py-1.5 text-[#111110]">{c.clientName}</td>
                    <td className="px-3 py-1.5 text-right text-[#6b6b66]">{c.belowTarget}</td>
                    <td className="px-3 py-1.5 text-right font-medium text-[#111110]">{money(c.undersoldNet)}</td>
                  </tr>
                ))}
              </tbody>
            </AggTable>
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <div className="px-5 py-3.5 border-b border-[#e4e4e0] flex items-center justify-between">
              <h2 className="text-[14px] font-semibold text-[#111110]">Просчёты ниже цели — худшие по деньгам</h2>
              <span className="text-[12px] text-[#9a9a95]">{report.orders.length}</span>
            </div>
            {report.orders.length === 0 ? (
              <div className="py-12 text-center text-[13px] text-[#8a8a85]">За период нет просчётов ниже целевой маржи 🎉</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-[#faf9f7] text-[12px] text-[#6b6b66]">
                    <tr>
                      <th className="text-left font-medium px-4 py-2.5">Дата</th>
                      <th className="text-left font-medium px-3 py-2.5">Клиент</th>
                      <th className="text-left font-medium px-3 py-2.5">Менеджер</th>
                      <th className="text-left font-medium px-3 py-2.5">Причина</th>
                      <th className="text-right font-medium px-3 py-2.5">Маржа прайс → факт</th>
                      <th className="text-right font-medium px-3 py-2.5">Скидка</th>
                      <th className="text-right font-medium px-4 py-2.5">Недозаработок ₽</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.orders.map(o => (
                      <tr key={o.id} className="border-t border-[#f0f0ec] hover:bg-[#faf9f7]">
                        <td className="px-4 py-2 text-[#6b6b66] whitespace-nowrap">{dateRu(o.createdAt)}</td>
                        <td className="px-3 py-2 text-[#111110]">{o.clientName}</td>
                        <td className="px-3 py-2 text-[#6b6b66]">{o.managerName ?? '—'}</td>
                        <td className="px-3 py-2">
                          <span className={`text-[11px] px-2 py-0.5 rounded border ${CAUSE_STYLE[o.cause]}`}>{CAUSE_LABEL[o.cause]}</span>
                          {o.missingCostPositions > 0 && (
                            <span className="ml-1 text-[11px] text-red-600">· {o.missingCostPositions} без цены</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <span className="text-[#9a9a95]">{pctv(o.marginList)}</span>
                          <span className="text-[#d8d8d4] mx-1">→</span>
                          <span className={`font-medium ${MARGIN_TEXT[o.color]}`}>{pctv(o.marginActual)}</span>
                        </td>
                        <td className="px-3 py-2 text-right text-[#6b6b66]">{o.discountPercent ? `${o.discountPercent}%` : '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold text-[#111110]">{money(o.undersoldNet)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className="text-[11px] text-[#9a9a95] mt-3">
            Маржа считается по выручке без НДС после скидки — так же, как при сохранении просчёта. Пороги берутся
            из настроек финмодели. «Недозаработок» — насколько выросла бы выручка, если поднять цену до целевой маржи
            при той же себестоимости.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: 'red' | 'green' }) {
  const color = accent === 'red' ? 'text-red-600' : accent === 'green' ? 'text-emerald-600' : 'text-[#111110]'
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-[12px] text-[#9a9a95]">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold ${color}`}>{value}</div>
    </div>
  )
}

function AggTable({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children : [children]
  const body = rows[1] as React.ReactElement<{ children?: React.ReactNode }> | undefined
  const isEmpty = !body || (Array.isArray(body.props?.children) && body.props.children.length === 0)
  return (
    <div className={`${CARD} overflow-hidden`}>
      <div className="px-4 py-3 border-b border-[#e4e4e0] text-[13px] font-semibold text-[#111110]">{title}</div>
      {isEmpty ? (
        <div className="px-4 py-6 text-center text-[12px] text-[#9a9a95]">{empty}</div>
      ) : (
        <table className="w-full text-[12px]">{rows}</table>
      )}
    </div>
  )
}
