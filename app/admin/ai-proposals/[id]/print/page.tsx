'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

// Backward-compatible item — supports old schema (name/price) and new (line_item/unit_price/total_price)
type RawItem = {
  line_item?:   string
  name?:        string
  dimensions?:  string
  quantity?:    number
  unit_price?:  number
  total_price?: number
  price?:       number
  note?:        string
  description?: string
}

type DraftPayload = {
  proposal_title?: string
  client_summary?: string
  items?: RawItem[]
  price_summary?: {
    subtotal?:     number
    total?:        number
    currency?:     string
    vat_included?: string
  }
  terms?: {
    lead_time_days?: [number, number]
    payment_terms?:  string
    warranty?:       string
    validity_days?:  number
  }
  exclusions?:      string[]
  manager_message?: string
}

type ProposalRecord = {
  id:                 number
  created_at:         string
  client_name:        string | null
  created_by:         string | null
  amo_lead_id?:       string | null
  related_entity_id?: string | null
  draft_payload:      DraftPayload | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('ru-RU') + ' ₽'
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function fmtLeadTime(lt: [number, number] | undefined): string {
  if (!lt) return 'уточняется'
  if (lt[0] === lt[1]) return `${lt[0]} рабочих дней`
  return `${lt[0]}–${lt[1]} рабочих дней`
}

// normItem — backward-compatible, DO NOT CHANGE
function normItem(item: RawItem, idx: number) {
  return {
    lineItem:   item.line_item ?? item.name ?? `Позиция ${idx + 1}`,
    dimensions: item.dimensions,
    quantity:   item.quantity ?? 1,
    unitPrice:  item.unit_price ?? item.price ?? 0,
    totalPrice: item.total_price ?? item.price ?? 0,
    note:       item.note ?? item.description,
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AIProposalPrintPage() {
  const params = useParams()
  const id     = params?.id as string | undefined

  const [proposal, setProposal] = useState<ProposalRecord | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/ai/proposals/${id}`)
      .then(r => r.json())
      .then((data: { ok: boolean; proposal?: ProposalRecord; error?: string }) => {
        if (data.ok && data.proposal) setProposal(data.proposal)
        else setError(data.error ?? 'Запись не найдена')
      })
      .catch(() => setError('Ошибка сети'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return (
    <div style={S.center}>
      Загрузка...
    </div>
  )

  if (error || !proposal) return (
    <div style={S.center}>
      <p style={{ color: '#c00' }}>{error ?? 'Не найдено'}</p>
      <button onClick={() => window.close()} style={S.btnSec}>Закрыть</button>
    </div>
  )

  const draft      = proposal.draft_payload
  const items      = (draft?.items ?? []).map(normItem)
  const summary    = draft?.price_summary
  const terms      = draft?.terms
  const exclusions = draft?.exclusions ?? []

  const dateStr    = fmtDate(proposal.created_at)
  const kpNum      = String(proposal.id)
  const dealCode   = proposal.amo_lead_id ?? proposal.related_entity_id ?? null
  const clientName = proposal.client_name ?? ''
  const preparedBy = proposal.created_by ?? 'M-Glass'
  const validUntil = addDays(proposal.created_at, terms?.validity_days ?? 14)
  const grandTotal = summary?.total ?? items.reduce((s, i) => s + i.totalPrice, 0)
  const subtotal   = summary?.subtotal ?? grandTotal
  const vatText    = summary?.vat_included ?? 'НДС не предусмотрен'
  const leadTime   = fmtLeadTime(terms?.lead_time_days)

  const notes: string[] = exclusions.length > 0
    ? exclusions
    : ['*Подъём одного изделия 500 ₽/этаж при необходимости']

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 12mm 14mm; }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
          font-size: 11px; line-height: 1.4; color: #111;
          background: #e8e8e6;
        }
        a { color: inherit; text-decoration: none; }
        @media print {
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .kp { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      {/* ─── Screen bar — hidden in print ──────────────────────────────────────── */}
      <div className="no-print" style={S.bar}>
        <div style={S.draftLabel}>⚠ Черновик — проверьте перед отправкой клиенту</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={S.chromeTip}>
            ⚙ Перед сохранением PDF <strong>отключите «Колонтитулы»</strong> (Headers and footers) в настройках печати Chrome
          </span>
          <button onClick={() => window.print()} style={S.btnPrimary}>🖨 Печать / PDF</button>
          <button onClick={() => window.close()} style={S.btnSec}>Закрыть</button>
        </div>
      </div>

      {/* ─── Document ──────────────────────────────────────────────────────────── */}
      <div className="kp" style={S.kp}>

        {/* ══ HEADER ══════════════════════════════════════════════════════════════ */}
        {/*
          Layout matches reference:
          LEFT  — brand (M GLASS + taglines)
          RIGHT — contacts + meta (date / КП / deal)
        */}
        <table style={S.headerTable}>
          <tbody>
            <tr>
              {/* Brand */}
              <td style={S.headerBrandCell}>
                <div style={S.brandName}>M GLASS</div>
                <div style={S.brandLine}>изделия из стекла</div>
                <div style={S.brandLine}>душевые, зеркала и лофт</div>
              </td>
              {/* Contacts */}
              <td style={S.headerContactCell}>
                <div style={S.contactItem}>https://mglass.pro/</div>
                <div style={S.contactItem}>8&nbsp;(925)&nbsp;788&nbsp;58&nbsp;37</div>
                <div style={S.contactItem}>mglass.ceo@gmail.com</div>
              </td>
              {/* Meta */}
              <td style={S.headerMetaCell}>
                <div style={S.metaLine}>
                  <span style={S.metaKey}>Дата</span>
                  <span style={S.metaVal}>{dateStr}</span>
                </div>
                <div style={S.metaLine}>
                  <span style={S.metaKey}>Номер КП</span>
                  <span style={S.metaVal}>{kpNum}</span>
                </div>
                {dealCode && (
                  <div style={S.metaLine}>
                    <span style={S.metaKey}>Код сделки</span>
                    <span style={S.metaVal}>{dealCode}</span>
                  </div>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {/* ══ TITLE ═══════════════════════════════════════════════════════════════ */}
        <div style={S.titleRow}>
          <span style={S.titleText}>Коммерческое предложение</span>
        </div>

        {/* ══ CLIENT INFO ══════════════════════════════════════════════════════════ */}
        <table style={S.clientTable}>
          <tbody>
            <tr>
              <td style={S.clientLblCell}>Заказчик</td>
              <td style={S.clientValCell}>{clientName || '—'}</td>
              <td style={S.clientRightCell}>
                <div style={S.clientRightRow}>
                  <span style={S.clientRightLbl}>Предложение актуально до</span>
                  <span style={S.clientRightVal}>{validUntil}</span>
                </div>
                <div style={S.clientRightRow}>
                  <span style={S.clientRightLbl}>Кем подготовлено</span>
                  <span style={S.clientRightVal}>{preparedBy}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ══ ITEMS TABLE ══════════════════════════════════════════════════════════ */}
        <table style={S.itemsTable}>
          <thead>
            <tr style={S.theadRow}>
              <th style={{ ...S.th, width: 26, textAlign: 'center' }}>№</th>
              <th style={{ ...S.th, textAlign: 'left' }}>Изделие</th>
              <th style={{ ...S.th, width: 70, textAlign: 'center' }}>Количество</th>
              <th style={{ ...S.th, width: 100, textAlign: 'right' }}>Цена за единицу</th>
              <th style={{ ...S.th, width: 100, textAlign: 'right', borderRight: 'none' }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#aaa', fontStyle: 'italic' }}>
                  Позиции не указаны
                </td>
              </tr>
            )}
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #ddd', background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                <td style={{ ...S.td, textAlign: 'center', color: '#999', verticalAlign: 'top', paddingTop: 8 }}>
                  {i + 1}
                </td>
                <td style={{ ...S.td, verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600, fontSize: 11 }}>{item.lineItem}</div>
                  {item.dimensions && (
                    <div style={{ fontSize: 10, color: '#555', marginTop: 1 }}>{item.dimensions}</div>
                  )}
                  {item.note && (
                    <div style={{ fontSize: 10, color: '#777', marginTop: 1 }}>{item.note}</div>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: 'center', verticalAlign: 'top', paddingTop: 8 }}>
                  {item.quantity}
                </td>
                <td style={{ ...S.td, textAlign: 'right', verticalAlign: 'top', paddingTop: 8, fontWeight: 600 }}>
                  {fmt(item.unitPrice)}
                </td>
                <td style={{ ...S.td, textAlign: 'right', verticalAlign: 'top', paddingTop: 8, fontWeight: 700, borderRight: 'none' }}>
                  {fmt(item.totalPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ══ TOTALS ═══════════════════════════════════════════════════════════════ */}
        <table style={S.totalsTable}>
          <tbody>
            <tr>
              {/* Left: lead time + notes */}
              <td style={S.termsCell}>
                <div>
                  {'Срок изготовления изделий из стекла '}
                  <strong>{leadTime}</strong>
                </div>
                {notes.map((n, i) => (
                  <div key={i} style={{ color: '#888', fontSize: 10, marginTop: 3 }}>{n}</div>
                ))}
              </td>

              {/* Right: subtotal + ИТОГО + НДС */}
              <td style={S.numbersCell}>
                {/* Subtotal */}
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid #ddd' }}>
                      <td style={S.numLbl}>Промежуточный итог</td>
                      <td style={S.numVal}>{fmt(subtotal)}</td>
                    </tr>
                    <tr>
                      <td style={{ ...S.numLbl, fontWeight: 700, fontSize: 12, paddingTop: 6 }}>ИТОГО:</td>
                      <td style={{ ...S.numVal, fontWeight: 800, fontSize: 14, paddingTop: 6 }}>{fmt(grandTotal)}</td>
                    </tr>
                  </tbody>
                </table>
                <div style={S.vatLine}>{vatText}</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ══ FOOTER ═══════════════════════════════════════════════════════════════ */}
        <div style={S.footer}>
          <div style={S.footerThanks}>Благодарим за обращение!</div>
        </div>

      </div>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DARK   = '#111'
const MUTED  = '#777'
const BORDER = '#ccc'

const S: Record<string, React.CSSProperties> = {

  center: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', color: MUTED, fontSize: 13, gap: 8,
  },

  // Screen bar
  bar: {
    position: 'sticky', top: 0, zIndex: 200,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
    padding: '7px 14px', background: '#fff', borderBottom: '1px solid #ddd', gap: 8,
  },
  draftLabel: { fontSize: 11, color: '#92400e', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 4, padding: '2px 8px' },
  chromeTip:  { fontSize: 10, color: MUTED, maxWidth: 380, lineHeight: 1.35 },
  btnPrimary: { padding: '6px 14px', background: DARK, color: '#fff', fontSize: 11, fontWeight: 600, borderRadius: 5, border: 'none', cursor: 'pointer' },
  btnSec:     { padding: '6px 12px', background: '#fff', color: '#555', fontSize: 11, border: '1px solid #ccc', borderRadius: 5, cursor: 'pointer', marginTop: 8 },

  // Document
  kp: {
    maxWidth: 750, margin: '16px auto 40px', background: '#fff',
    boxShadow: '0 1px 8px rgba(0,0,0,0.12)',
  },

  // ── Header table ──
  headerTable: {
    width: '100%', borderCollapse: 'collapse',
    borderBottom: `2px solid ${DARK}`, padding: 0,
  },
  headerBrandCell: {
    padding: '12px 14px', verticalAlign: 'top', width: '34%',
    borderRight: `1px solid ${BORDER}`,
  },
  brandName: { fontSize: 17, fontWeight: 800, color: DARK, letterSpacing: 1, lineHeight: 1.1 },
  brandLine: { fontSize: 9, color: MUTED, marginTop: 2 },

  headerContactCell: {
    padding: '12px 14px', verticalAlign: 'top', width: '33%',
    borderRight: `1px solid ${BORDER}`,
  },
  contactItem: { fontSize: 9, color: MUTED, lineHeight: 1.7 },

  headerMetaCell: {
    padding: '12px 14px', verticalAlign: 'top', width: '33%',
    textAlign: 'right',
  },
  metaLine: { display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 2, alignItems: 'baseline' },
  metaKey:  { fontSize: 9, color: MUTED },
  metaVal:  { fontSize: 10, fontWeight: 700, color: DARK },

  // ── Title ──
  titleRow: {
    padding: '10px 14px 8px', borderBottom: `1px solid ${BORDER}`,
    textAlign: 'center',
  },
  titleText: { fontSize: 14, fontWeight: 700, color: DARK },

  // ── Client table ──
  clientTable: {
    width: '100%', borderCollapse: 'collapse',
    borderBottom: `1px solid ${BORDER}`,
  },
  clientLblCell: {
    padding: '8px 14px', fontSize: 9, color: MUTED, textTransform: 'uppercase',
    letterSpacing: 0.4, verticalAlign: 'middle', width: 120, whiteSpace: 'nowrap',
    borderRight: `1px solid ${BORDER}`,
  },
  clientValCell: {
    padding: '8px 14px', fontSize: 13, fontWeight: 700, color: DARK,
    verticalAlign: 'middle', borderRight: `1px solid ${BORDER}`,
  },
  clientRightCell: {
    padding: '7px 14px', verticalAlign: 'middle', textAlign: 'right',
    fontSize: 10, whiteSpace: 'nowrap',
  },
  clientRightRow: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 3, alignItems: 'baseline' },
  clientRightLbl: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3 },
  clientRightVal: { fontSize: 11, fontWeight: 600, color: DARK },

  // ── Items table ──
  itemsTable: { width: '100%', borderCollapse: 'collapse' },
  theadRow:   { background: DARK },
  th: {
    background: DARK, color: '#fff', padding: '7px 10px',
    fontSize: 9, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase',
    borderRight: '1px solid rgba(255,255,255,0.15)',
  },
  td: {
    padding: '7px 10px', fontSize: 11, borderRight: `1px solid ${BORDER}`,
    verticalAlign: 'middle',
  },

  // ── Totals table ──
  totalsTable: {
    width: '100%', borderCollapse: 'collapse',
    borderTop: `1px solid ${BORDER}`,
  },
  termsCell: {
    padding: '10px 14px', fontSize: 10, color: '#444', verticalAlign: 'top',
    lineHeight: 1.6, borderRight: `1px solid ${BORDER}`,
  },
  numbersCell: {
    padding: '10px 14px', verticalAlign: 'top', width: 230,
  },
  numLbl: { padding: '2px 8px 2px 0', fontSize: 10, color: MUTED, textAlign: 'left' },
  numVal: { padding: '2px 0', fontSize: 11, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  vatLine: { fontSize: 9, color: MUTED, marginTop: 6, fontStyle: 'italic', textAlign: 'right' },

  // ── Footer ──
  footer: {
    padding: '10px 14px 12px', borderTop: `1px solid ${BORDER}`,
    textAlign: 'right',
  },
  footerThanks: { fontSize: 13, fontWeight: 700, color: DARK },
}
