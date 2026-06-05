'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

// Backward-compatible item — supports both old schema (name/price) and new (line_item/unit_price/total_price)
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
    subtotal?:      number
    total?:         number
    currency?:      string
    vat_included?:  string
  }
  terms?: {
    lead_time_days?: [number, number]
    payment_terms?:  string
    warranty?:       string
    validity_days?:  number
  }
  exclusions?: string[]
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
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
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

// Normalise one item from either schema version
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

// ─── Print page ───────────────────────────────────────────────────────────────

export default function AIProposalPrintPage() {
  const params  = useParams()
  const id      = params?.id as string | undefined

  const [proposal, setProposal] = useState<ProposalRecord | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    fetch(`/api/ai/proposals/${id}`)
      .then(r => r.json())
      .then((data: { ok: boolean; proposal?: ProposalRecord; error?: string }) => {
        if (data.ok && data.proposal) {
          setProposal(data.proposal)
        } else {
          setError(data.error ?? 'Запись не найдена')
        }
      })
      .catch(() => setError('Ошибка сети'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return (
      <div style={S.center}>
        <div style={S.spinner} />
        Загрузка черновика...
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div style={S.center}>
        <p style={{ color: '#d00', fontSize: 14 }}>{error ?? 'Не найдено'}</p>
        <button onClick={() => window.close()} style={{ ...S.btnSec, marginTop: 12 }}>Закрыть</button>
      </div>
    )
  }

  const draft      = proposal.draft_payload
  const items      = (draft?.items ?? []).map(normItem)
  const summary    = draft?.price_summary
  const terms      = draft?.terms
  const exclusions = draft?.exclusions ?? []

  const dateStr   = fmtDate(proposal.created_at)
  const kpNum     = `КП-${String(proposal.id).padStart(4, '0')}`
  const dealCode  = proposal.amo_lead_id ?? proposal.related_entity_id ?? null
  const clientName = proposal.client_name ?? '—'
  const preparedBy = proposal.created_by ?? 'M-Glass'
  const validUntil = addDays(proposal.created_at, terms?.validity_days ?? 14)
  const grandTotal = summary?.total ?? items.reduce((s, i) => s + i.totalPrice, 0)
  const subtotal   = summary?.subtotal ?? grandTotal

  const vatText = summary?.vat_included ?? 'НДС не предусмотрен'
  const leadTimeText = fmtLeadTime(terms?.lead_time_days)

  // Use exclusions as footer notes; add standard lift note if exclusions empty
  const notes = exclusions.length > 0
    ? exclusions
    : ['*Подъём одного изделия 500 ₽/этаж при необходимости']

  return (
    <>
      <style>{`
        @page { margin: 14mm 14mm; size: A4 portrait; }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; background: #f4f4f2; color: #111110; font-size: 12px; line-height: 1.5; }
        @media print {
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-sheet { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      {/* ── Screen controls (hidden when printing) ── */}
      <div className="no-print" style={S.controls}>
        <div style={S.draftBadge}>
          ⚠ Черновик КП — перед отправкой клиенту проверьте данные
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => window.print()} style={S.btnPrimary}>
            🖨 Печать / сохранить PDF
          </button>
          <button onClick={() => window.close()} style={S.btnSec}>
            Закрыть
          </button>
        </div>
      </div>

      {/* ── A4 Sheet ── */}
      <div className="page-sheet" style={S.sheet}>

        {/* ── HEADER ── */}
        <div style={S.header}>
          <div style={S.headerLeft}>
            <div style={S.brandName}>M GLASS</div>
            <div style={S.brandSub}>изделия из стекла</div>
            <div style={S.brandSub}>душевые, зеркала и лофт</div>
          </div>
          <div style={S.headerRight}>
            <div style={S.contactLine}>
              <a href="https://mglass.pro/" style={S.contactLink}>mglass.pro</a>
            </div>
            <div style={S.contactLine}>8&nbsp;(925)&nbsp;788&nbsp;58&nbsp;37</div>
            <div style={S.contactLine}>mglass.ceo@gmail.com</div>
          </div>
        </div>

        {/* ── META BAND ── */}
        <div style={S.metaBand}>
          <div style={S.metaLeft}>
            <div style={S.metaRow}>
              <span style={S.metaLabel}>Дата</span>
              <span style={S.metaValue}>{dateStr}</span>
            </div>
            <div style={S.metaRow}>
              <span style={S.metaLabel}>Номер КП</span>
              <span style={S.metaValue}>{kpNum}</span>
            </div>
            {dealCode && (
              <div style={S.metaRow}>
                <span style={S.metaLabel}>Код сделки</span>
                <span style={S.metaValue}>{dealCode}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── DOCUMENT TITLE ── */}
        <div style={S.titleBlock}>
          <div style={S.titleLabel}>КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</div>
        </div>

        {/* ── CLIENT BLOCK ── */}
        <div style={S.clientBlock}>
          <div style={S.clientRow}>
            <span style={S.fieldLabel}>Заказчик</span>
            <span style={S.clientName}>{clientName}</span>
          </div>
          <div style={S.clientRow}>
            <span style={S.fieldLabel}>Предложение актуально до</span>
            <span style={S.clientValue}>{validUntil}</span>
          </div>
          <div style={S.clientRow}>
            <span style={S.fieldLabel}>Кем подготовлено</span>
            <span style={S.clientValue}>{preparedBy}</span>
          </div>
        </div>

        {/* ── ITEMS TABLE ── */}
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 30, textAlign: 'center' }}>№</th>
              <th style={{ ...S.th, textAlign: 'left' }}>Изделие</th>
              <th style={{ ...S.th, width: 60, textAlign: 'center' }}>Количество</th>
              <th style={{ ...S.th, width: 120, textAlign: 'right' }}>Цена за единицу</th>
              <th style={{ ...S.th, width: 120, textAlign: 'right', borderRight: 'none' }}>Сумма</th>
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
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf9', borderBottom: '1px solid #ebebea' }}>
                <td style={{ ...S.td, textAlign: 'center', color: '#aaa', verticalAlign: 'top', paddingTop: 11 }}>
                  {i + 1}
                </td>
                <td style={{ ...S.td, verticalAlign: 'top' }}>
                  <div style={{ fontWeight: 600, color: '#111110', fontSize: 12 }}>{item.lineItem}</div>
                  {item.dimensions && (
                    <div style={{ color: '#666', fontSize: 11, marginTop: 1 }}>{item.dimensions}</div>
                  )}
                  {item.note && (
                    <div style={{ color: '#aaa', fontSize: 10, marginTop: 2, fontStyle: 'italic' }}>{item.note}</div>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: 'center', verticalAlign: 'top', paddingTop: 11 }}>
                  {item.quantity}
                </td>
                <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace', color: '#444', verticalAlign: 'top', paddingTop: 11 }}>
                  {fmt(item.unitPrice)}
                </td>
                <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'ui-monospace, monospace', fontWeight: 600, color: '#111110', verticalAlign: 'top', paddingTop: 11, borderRight: 'none' }}>
                  {fmt(item.totalPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── TOTALS BLOCK ── */}
        <div style={S.totalsBlock}>
          {/* Left — terms & notes */}
          <div style={S.termsCol}>
            <div style={S.termsRow}>
              <span style={S.termsLabel}>Срок изготовления изделий из стекла:</span>
              <span style={S.termsValue}>{leadTimeText}</span>
            </div>
            {notes.map((n, i) => (
              <div key={i} style={S.noteRow}>{n}</div>
            ))}
          </div>

          {/* Right — numbers */}
          <div style={S.numbersCol}>
            <div style={S.subtotalRow}>
              <span style={{ color: '#888' }}>Промежуточный итог</span>
              <span style={S.monoNum}>{fmt(subtotal)}</span>
            </div>

            <div style={S.totalBox}>
              <span style={S.totalLabel}>ИТОГО</span>
              <span style={S.totalPrice}>{fmt(grandTotal)}</span>
            </div>

            <div style={S.vatRow}>{vatText}</div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div style={S.footer}>
          <div style={S.footerLeft}>
            <div style={S.footerBrand}>M Glass</div>
            <div style={S.footerContact}>
              <a href="https://mglass.pro/" style={S.contactLink}>mglass.pro</a>
              {' · '}
              8&nbsp;(925)&nbsp;788&nbsp;58&nbsp;37
              {' · '}
              mglass.ceo@gmail.com
            </div>
          </div>
          <div style={S.footerRight}>
            <div style={S.footerThanks}>Благодарим за обращение!</div>
            <div style={S.footerValidity}>Предложение действительно до {validUntil}</div>
          </div>
        </div>

      </div>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const BRAND = '#111110'
const MUTED  = '#8a8a85'
const BORDER = '#e4e4e0'

const S: Record<string, React.CSSProperties> = {
  center: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    minHeight: '100vh', color: MUTED, fontSize: 13, gap: 8,
  },
  spinner: {
    width: 18, height: 18, border: '2px solid #d0d0cc', borderTopColor: MUTED,
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },

  controls: {
    position: 'sticky', top: 0, zIndex: 100,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: 'rgba(255,255,255,0.95)',
    borderBottom: '1px solid #e4e4e0', backdropFilter: 'blur(6px)',
    gap: 12,
  },
  draftBadge: {
    fontSize: 11, color: '#92400e', background: '#fef3c7',
    border: '1px solid #fde68a', borderRadius: 6, padding: '4px 10px',
  },
  btnPrimary: {
    padding: '8px 18px', background: BRAND, color: '#fff',
    fontSize: 12, fontWeight: 600, borderRadius: 7, border: 'none', cursor: 'pointer',
  },
  btnSec: {
    padding: '8px 16px', background: '#fff', color: '#555',
    fontSize: 12, border: '1px solid #d4d4d0', borderRadius: 7, cursor: 'pointer',
  },

  sheet: {
    maxWidth: 740, margin: '24px auto 48px', background: '#fff',
    boxShadow: '0 2px 16px rgba(0,0,0,0.08)', borderRadius: 4,
    paddingBottom: 32,
  },

  // Header
  header: {
    background: BRAND, color: '#fff',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '20px 28px 18px',
  },
  headerLeft: { display: 'flex', flexDirection: 'column', gap: 2 },
  brandName:  { fontSize: 22, fontWeight: 800, letterSpacing: 1.5, fontFamily: 'Georgia, serif', lineHeight: 1 },
  brandSub:   { fontSize: 10, color: 'rgba(255,255,255,0.55)', letterSpacing: 0.3, marginTop: 2 },
  headerRight: { textAlign: 'right', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' },
  contactLine: { fontSize: 11, color: 'rgba(255,255,255,0.75)' },
  contactLink: { color: 'rgba(255,255,255,0.75)', textDecoration: 'none' },

  // Meta band
  metaBand: {
    background: '#f7f7f6', borderBottom: `1px solid ${BORDER}`,
    padding: '10px 28px',
    display: 'flex', gap: 32, flexWrap: 'wrap',
  },
  metaLeft: { display: 'flex', gap: 24, flexWrap: 'wrap' },
  metaRow:  { display: 'flex', flexDirection: 'column', gap: 1 },
  metaLabel: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaValue: { fontSize: 11, fontWeight: 700, color: BRAND },

  // Title
  titleBlock: { padding: '22px 28px 14px', borderBottom: `1px solid ${BORDER}` },
  titleLabel: {
    fontSize: 17, fontWeight: 800, color: BRAND,
    fontFamily: 'Georgia, serif', letterSpacing: 0.2,
  },

  // Client block
  clientBlock: { padding: '12px 28px 16px', borderBottom: `1px solid ${BORDER}` },
  clientRow:   { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 5 },
  fieldLabel:  { fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, minWidth: 200, flexShrink: 0 },
  clientName:  { fontSize: 14, fontWeight: 700, color: BRAND },
  clientValue: { fontSize: 12, fontWeight: 500, color: '#333' },

  // Table
  table: { width: '100%', borderCollapse: 'collapse', borderTop: `2px solid ${BRAND}` },
  th: {
    background: BRAND, color: '#fff', padding: '9px 12px',
    fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
    textTransform: 'uppercase', borderRight: '1px solid rgba(255,255,255,0.12)',
  },
  td: { padding: '9px 12px', fontSize: 12, borderRight: `1px solid ${BORDER}` },

  // Totals
  totalsBlock: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 28px 0', gap: 20, borderTop: `1px solid ${BORDER}`, marginTop: 0,
  },
  termsCol: { flex: 1, fontSize: 10, color: '#666', lineHeight: 1.8 },
  termsRow: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  termsLabel: { color: MUTED },
  termsValue: { fontWeight: 600, color: '#333' },
  noteRow: { color: '#aaa', fontSize: 9, fontStyle: 'italic', marginTop: 2 },

  numbersCol: { minWidth: 260 },
  subtotalRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 11, paddingBottom: 8, borderBottom: `1px solid ${BORDER}`, marginBottom: 8,
  },
  monoNum: { fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' },

  totalBox: {
    background: BRAND, color: '#fff', borderRadius: 6,
    padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 6,
  },
  totalLabel: { fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' },
  totalPrice: { fontSize: 20, fontWeight: 800, fontFamily: 'ui-monospace, monospace', fontVariantNumeric: 'tabular-nums' },

  vatRow: { fontSize: 10, color: MUTED, textAlign: 'right', fontStyle: 'italic' },

  // Footer
  footer: {
    marginTop: 28, paddingTop: 16, borderTop: `1px solid ${BORDER}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
    padding: '16px 28px 0',
  },
  footerLeft: {},
  footerBrand: { fontSize: 12, fontWeight: 700, fontFamily: 'Georgia, serif', color: '#444', marginBottom: 3 },
  footerContact: { fontSize: 10, color: MUTED, lineHeight: 1.7 },
  footerRight: { textAlign: 'right' },
  footerThanks: { fontSize: 15, fontWeight: 700, fontFamily: 'Georgia, serif', color: BRAND },
  footerValidity: { fontSize: 10, color: MUTED, marginTop: 3 },
}
