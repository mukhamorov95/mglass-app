'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase-browser'
import QRCode from 'qrcode'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

type OrderItem = {
  materialName?: string
  category?: string
  thickness?: number
  width?: number
  height?: number
  quantity?: number
  totalAreaNet?: number
  totalWeight?: number
  hasTempering?: boolean
  hasFacet?: boolean
  facetTypeMm?: number
  services?: { name: string; cost: number }[]
  comment?: string
}

type NotesData = {
  status?: string
  launched_at?: string
  work_started_at?: string
  production_days?: number
  user_notes?: string
}

type Order = {
  id: number
  client_name: string
  custom_number: string | null
  client_order_number: string | null
  items: OrderItem[]
  notes: string | null
  total_area: number
  total_weight: number
  created_at: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseNotes(notes: string | null): NotesData {
  if (!notes) return {}
  try {
    const p = JSON.parse(notes)
    if (typeof p === 'object' && p !== null) return p as NotesData
  } catch {}
  return {}
}

function fmtDate(s: string | undefined | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Inline styles ────────────────────────────────────────────────────────────

const thS: React.CSSProperties = {
  border: '1px solid #bbb',
  padding: '4px 6px',
  fontWeight: 700,
  fontSize: 10,
  textAlign: 'center',
  background: '#eeeee8',
  whiteSpace: 'nowrap',
}

const tdS: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '4px 6px',
  fontSize: 11,
  verticalAlign: 'middle',
}

const markS: React.CSSProperties = {
  border: '1px solid #bbb',
  padding: '3px 2px',
  minWidth: 26,
  minHeight: 22,
  textAlign: 'center',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProductionSheetPage() {
  const { id } = useParams<{ id: string }>()
  const orderId = Number(id)

  const [order, setOrder]       = useState<Order | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const sb = createClient()
      const { data: { user } } = await sb.auth.getUser()
      if (!user) { setError('Не авторизован'); setLoading(false); return }

      const { data, error: dbErr } = await sb
        .from('b2b_orders')
        .select('id,client_name,custom_number,client_order_number,items,notes,total_area,total_weight,created_at')
        .eq('id', orderId)
        .single()

      if (dbErr || !data) {
        setError('Заказ не найден')
        setLoading(false)
        return
      }

      const loaded: Order = {
        ...data,
        items: Array.isArray(data.items) ? (data.items as OrderItem[]) : [],
      }
      setOrder(loaded)

      // Generate QR for /p/o/{orderId}
      const qrUrl = `${window.location.origin}/p/o/${orderId}`
      try {
        const dataUrl = await QRCode.toDataURL(qrUrl, { width: 160, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
        setQrDataUrl(dataUrl)
      } catch (e) {
        console.error('[production-sheet] QR generation failed:', e)
      }

      setLoading(false)
    }
    if (orderId && !isNaN(orderId)) load()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    else { setError('Неверный ID заказа'); setLoading(false) }
  }, [orderId])

  // ─── Loading / error states ────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center text-[13px] text-[#8a8a85]">
      Загрузка...
    </div>
  )

  if (error || !order) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-[14px] text-red-600 mb-3">{error ?? 'Ошибка загрузки'}</p>
        <Link href="/b2b-orders" className="text-[12px] text-blue-600 underline">
          ← Назад к заказам
        </Link>
      </div>
    </div>
  )

  // ─── Derived values ────────────────────────────────────────────────────────

  const pn          = parseNotes(order.notes)
  const launchDate  = pn.launched_at ?? pn.work_started_at ?? null
  const orderLabel  = order.custom_number?.trim() || `#${order.id}`
  const totalQty    = order.items.reduce((s, i) => s + (i.quantity ?? 1), 0)
  const totalArea   = (order.total_area ?? 0) > 0
    ? order.total_area
    : order.items.reduce((s, i) => s + (i.totalAreaNet ?? 0), 0)
  const totalWeight = (order.total_weight ?? 0) > 0
    ? order.total_weight
    : order.items.reduce((s, i) => s + (i.totalWeight ?? 0), 0)

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* ── Print CSS ──────────────────────────────────────────────────────── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-root { padding: 10mm 12mm; font-family: Arial, sans-serif; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #999; padding: 3px 5px; font-size: 9pt; }
          .qr-img { width: 38mm; height: 38mm; }
          .sheet-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
        }
        @media screen {
          .print-root { max-width: 980px; margin: 0 auto; padding: 28px 24px; }
          .sheet-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
        }
      `}</style>

      {/* ── Screen nav (hidden on print) ───────────────────────────────────── */}
      <div className="no-print sticky top-0 z-10 bg-white border-b border-[#e4e4e0] px-4 py-2.5 flex items-center justify-between">
        <Link
          href="/b2b-orders"
          className="text-[12px] text-[#6b6b66] hover:text-[#111110] transition-colors"
        >
          ← Назад к заказам
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#9a9a95]">Производственный лист</span>
          <button
            onClick={() => window.print()}
            className="px-4 py-1.5 bg-[#111110] text-white text-[12px] font-semibold rounded-lg hover:bg-[#2a2a28] transition-colors"
          >
            🖨 Печать
          </button>
        </div>
      </div>

      {/* ── Production sheet ───────────────────────────────────────────────── */}
      <div className="print-root">

        {/* Header row */}
        <div className="sheet-header">

          {/* Left: order info */}
          <div>
            <div style={{ fontSize: 10, color: '#888', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              M-GLASS · Производственный лист
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#111', marginBottom: 4, letterSpacing: '-0.02em' }}>
              {orderLabel}
              {order.client_order_number && (
                <span style={{ fontSize: 13, fontWeight: 400, color: '#777', marginLeft: 10 }}>
                  (кл.&nbsp;{order.client_order_number})
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#333', marginBottom: 3 }}>
              Клиент: <strong>{order.client_name}</strong>
            </div>
            <div style={{ fontSize: 11, color: '#555', marginBottom: 2 }}>
              {launchDate
                ? <>Запуск:&nbsp;<strong>{fmtDate(launchDate)}</strong></>
                : <>Создан:&nbsp;<strong>{fmtDate(order.created_at)}</strong></>
              }
              {pn.production_days ? <>&nbsp;·&nbsp;срок&nbsp;<strong>{pn.production_days}&nbsp;дн.</strong></> : null}
            </div>
            <div style={{ fontSize: 10, color: '#888' }}>
              {order.items.length}&nbsp;поз.&nbsp;·&nbsp;
              {totalQty}&nbsp;шт&nbsp;·&nbsp;
              {totalArea.toFixed(2)}&nbsp;м²&nbsp;·&nbsp;
              {totalWeight.toFixed(1)}&nbsp;кг
            </div>
          </div>

          {/* Right: QR code */}
          <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 24 }}>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR заказ ${orderLabel}`}
                className="qr-img"
                style={{ width: 110, height: 110, display: 'block', border: '1px solid #ddd' }}
              />
            ) : (
              <div style={{
                width: 110, height: 110, background: '#f4f4f0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, color: '#aaa', border: '1px solid #ddd',
              }}>
                QR...
              </div>
            )}
            <div style={{ fontSize: 9, color: '#999', marginTop: 4 }}>
              Сканируй для отметок
            </div>
            <div style={{ fontSize: 8, color: '#bbb', marginTop: 1, fontFamily: 'monospace' }}>
              /p/o/{order.id}
            </div>
          </div>
        </div>

        {/* Items table */}
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={thS}>#</th>
              <th style={{ ...thS, textAlign: 'left', minWidth: 120 }}>Материал</th>
              <th style={thS}>мм</th>
              <th style={{ ...thS, minWidth: 90 }}>Размер (мм)</th>
              <th style={thS}>Кол.</th>
              <th style={thS}>м²</th>
              <th style={{ ...thS, color: '#a33' }}>З</th>
              <th style={{ ...thS, textAlign: 'left', minWidth: 100 }}>Услуги / Прим.</th>
              {/* Manual mark columns */}
              <th style={{ ...thS, background: '#fff8f0', color: '#555', width: 28 }}>Р</th>
              <th style={{ ...thS, background: '#fff8f0', color: '#555', width: 28 }}>ПК</th>
              <th style={{ ...thS, background: '#fff8f0', color: '#555', width: 28 }}>СВ</th>
              <th style={{ ...thS, background: '#fff8f0', color: '#a33', width: 28 }}>З</th>
              <th style={{ ...thS, background: '#fff8f0', color: '#555', width: 28 }}>УП</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item, idx) => {
              const svcs = Array.isArray(item.services)
                ? item.services.map(s => s.name).join(', ')
                : ''
              const comment = item.comment?.trim() ?? ''
              const facet   = item.hasFacet && item.facetTypeMm ? `Фацет ${item.facetTypeMm}` : item.hasFacet ? 'Фацет' : ''
              const extra   = [svcs, facet, comment].filter(Boolean).join(' · ')
              const rowBg   = idx % 2 === 0 ? '#fff' : '#fafaf9'

              return (
                <tr key={idx} style={{ background: rowBg }}>
                  <td style={{ ...tdS, textAlign: 'center', color: '#bbb', fontWeight: 700 }}>{idx + 1}</td>
                  <td style={tdS}>
                    <span style={{ fontWeight: 600 }}>{item.materialName ?? '—'}</span>
                    {item.category ? (
                      <span style={{ fontSize: 9, color: '#aaa', marginLeft: 4 }}>{item.category}</span>
                    ) : null}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', fontFamily: 'monospace' }}>
                    {item.thickness ?? '—'}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', fontFamily: 'monospace', fontWeight: 700 }}>
                    {(item.width ?? '—')}×{(item.height ?? '—')}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center' }}>
                    {item.quantity ?? 1}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', fontFamily: 'monospace', fontSize: 10 }}>
                    {(item.totalAreaNet ?? 0).toFixed(3)}
                  </td>
                  <td style={{ ...tdS, textAlign: 'center', fontWeight: 700, color: item.hasTempering ? '#a33' : '#ddd' }}>
                    {item.hasTempering ? '✓' : '—'}
                  </td>
                  <td style={{ ...tdS, fontSize: 10, color: '#555' }}>
                    {extra || '—'}
                  </td>
                  {/* Empty cells for manual marks */}
                  <td style={{ ...markS, background: '#fffdf8' }} />
                  <td style={{ ...markS, background: '#fffdf8' }} />
                  <td style={{ ...markS, background: '#fffdf8' }} />
                  <td style={{ ...markS, background: '#fff8f8' }} />
                  <td style={{ ...markS, background: '#fffdf8' }} />
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: '#eeeee8', fontWeight: 700 }}>
              <td colSpan={4} style={{ ...tdS, textAlign: 'right', color: '#666', fontSize: 10 }}>
                Итого {order.items.length}&nbsp;{order.items.length === 1 ? 'позиция' : order.items.length < 5 ? 'позиции' : 'позиций'}
              </td>
              <td style={{ ...tdS, textAlign: 'center' }}>{totalQty}</td>
              <td style={{ ...tdS, textAlign: 'center', fontFamily: 'monospace' }}>
                {totalArea.toFixed(2)}
              </td>
              <td colSpan={7} style={tdS} />
            </tr>
          </tfoot>
        </table>

        {/* Legend */}
        <div style={{
          marginTop: 10, padding: '5px 10px',
          border: '1px solid #ddd', borderRadius: 4,
          fontSize: 9.5, color: '#555', lineHeight: 1.6,
        }}>
          <strong>Легенда:</strong>&nbsp;&nbsp;
          <strong>Р</strong>&nbsp;— резка&nbsp;&nbsp;
          <strong>ПК</strong>&nbsp;— полировка&nbsp;/&nbsp;кромка&nbsp;&nbsp;
          <strong>СВ</strong>&nbsp;— сверление&nbsp;&nbsp;
          <strong>З</strong>&nbsp;— закалка&nbsp;&nbsp;
          <strong>УП</strong>&nbsp;— упаковано&nbsp;&nbsp;
          <strong>ПР</strong>&nbsp;— проблема&nbsp;/&nbsp;переделка
        </div>

        {/* Signature line */}
        <div style={{ marginTop: 14, display: 'flex', gap: 32, fontSize: 11, color: '#444', flexWrap: 'wrap' }}>
          <span>Принял:&nbsp;______________________</span>
          <span>Подпись:&nbsp;______________________</span>
          <span>Дата&nbsp;выдачи:&nbsp;_______________</span>
        </div>

      </div>
    </>
  )
}
