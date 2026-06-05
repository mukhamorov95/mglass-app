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
  return n.toLocaleString('ru-RU') + ' ₽'
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

// Normalise item from either schema version
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
      <div style={S.spinner} />
      Загрузка черновика...
    </div>
  )

  if (error || !proposal) return (
    <div style={S.center}>
      <p style={{ color: '#c00', fontSize: 13 }}>{error ?? 'Не найдено'}</p>
      <button onClick={() => window.close()} style={{ ...S.btnSec, marginTop: 12 }}>Закрыть</button>
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
  const clientName = proposal.client_name ?? '—'
  const preparedBy = proposal.created_by ?? 'M-Glass'
  const validUntil = addDays(proposal.created_at, terms?.validity_days ?? 14)
  const grandTotal = summary?.total ?? items.reduce((s, i) => s + i.totalPrice, 0)
  const subtotal   = summary?.subtotal ?? grandTotal
  const vatText    = summary?.vat_included ?? 'НДС не предусмотрен'
  const leadTimeText = fmtLeadTime(terms?.lead_time_days)

  const notes = exclusions.length > 0
    ? exclusions
    : ['*Подъём одного изделия 500 ₽/этаж при необходимости']

  return (
    <>
      <style>{`
        @page { size: A4 portrait; margin: 10mm; }
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 11px; line-height: 1.45; color: #1a1a18; background: #efefed; }
        a { color: inherit; text-decoration: none; }
        @media print {
          body { background: #fff !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .doc { box-shadow: none !important; margin: 0 !important; max-width: 100% !important; border: none !important; }
          tr { page-break-inside: avoid; }
        }
      `}</style>

      {/* ── Screen bar (hidden when printing) ── */}
      <div className="no-print" style={S.bar}>
        <div style={S.draftBadge}>
          ⚠ Черновик — проверьте перед отправкой
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={S.printTip}>
            При сохранении PDF отключите «Колонтитулы» (Headers and footers) в настройках Chrome
          </span>
          <button onClick={() => window.print()} style={S.btnPrimary}>🖨 Печать / PDF</button>
          <button onClick={() => window.close()} style={S.btnSec}>Закрыть</button>
        </div>
      </div>

      {/* ── Document ── */}
      <div className="doc" style={S.doc}>

        {/* ══ HEADER ══ */}
        <div style={S.header}>
          {/* Left: brand */}
          <div style={S.brandBlock}>
            <div style={S.brandLogo}>
              <span style={S.logoBox}>M</span>
              <span style={S.logoGlass}>GLASS</span>
            </div>
            <div style={S.brandSub}>изделия из стекла</div>
            <div style={S.brandCats}>душевые, зеркала и лофт</div>
          </div>

          {/* Right: contacts + meta */}
          <div style={S.headerRight}>
            <div style={S.contactBlock}>
              <div style={S.contactLine}>https://mglass.pro/</div>
              <div style={S.contactLine}>8&nbsp;(925)&nbsp;788&nbsp;58&nbsp;37</div>
              <div style={S.contactLine}>mglass.ceo@gmail.com</div>
            </div>
            <div style={S.metaBlock}>
              <div style={S.metaRow}>
                <span style={S.metaLbl}>Дата</span>
                <span style={S.metaVal}>{dateStr}</span>
              </div>
              <div style={S.metaRow}>
                <span style={S.metaLbl}>Номер КП</span>
                <span style={S.metaVal}>{kpNum}</span>
              </div>
              {dealCode && (
                <div style={S.metaRow}>
                  <span style={S.metaLbl}>Код сделки</span>
                  <span style={S.metaVal}>{dealCode}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ══ TITLE ══ */}
        <div style={S.titleBlock}>
          <span style={S.titleText}>Коммерческое предложение</span>
        </div>

        {/* ══ CLIENT INFO ══ */}
        <div style={S.clientBlock}>
          <div style={S.clientLeft}>
            <span style={S.clientLbl}>Заказчик</span>
            <span style={S.clientName}>{clientName}</span>
          </div>
          <div style={S.clientRight}>
            <div style={S.clientRow}>
              <span style={S.clientLbl}>Предложение актуально до</span>
              <span style={S.clientVal}>{validUntil}</span>
            </div>
            <div style={S.clientRow}>
              <span style={S.clientLbl}>Кем подготовлено</span>
              <span style={S.clientVal}>{preparedBy}</span>
            </div>
          </div>
        </div>

        {/* ══ TABLE ══ */}
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 28, textAlign: 'center' }}>№</th>
              <th style={{ ...S.th, textAlign: 'left' }}>Изделие</th>
              <th style={{ ...S.th, width: 72, textAlign: 'center' }}>Количество</th>
              <th style={{ ...S.th, width: 108, textAlign: 'right' }}>Цена за единицу</th>
              <th style={{ ...S.th, width: 108, textAlign: 'right', borderRight: 'none' }}>Сумма</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={5} style={{ ...S.td, textAlign: 'center', color: '#aaa', fontStyle: 'italic', padding: '14px 12px' }}>
                  Позиции не указаны
                </td>
              </tr>
            )}
            {items.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafaf8', borderBottom: '1px solid #ebebea' }}>
                <td style={{ ...S.td, textAlign: 'center', color: '#bbb', verticalAlign: 'top', paddingTop: 9 }}>
                  {i + 1}
                </td>
                <td style={{ ...S.td, verticalAlign: 'top', lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 700, color: '#111', fontSize: 11 }}>{item.lineItem}</div>
                  {item.dimensions && (
                    <div style={{ color: '#555', fontSize: 10, marginTop: 1 }}>{item.dimensions}</div>
                  )}
                  {item.note && (
                    <div style={{ color: '#888', fontSize: 10, marginTop: 2 }}>{item.note}</div>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: 'center', verticalAlign: 'top', paddingTop: 9 }}>
                  {item.quantity}
                </td>
                <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#333', verticalAlign: 'top', paddingTop: 9, fontWeight: 600 }}>
                  {fmt(item.unitPrice)}
                </td>
                <td style={{ ...S.td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: '#111', verticalAlign: 'top', paddingTop: 9, borderRight: 'none' }}>
                  {fmt(item.totalPrice)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ══ TOTALS ══ */}
        <div style={S.totalsSection}>
          {/* Left: lead time + notes */}
          <div style={S.termsCol}>
            <div style={S.leadTimeRow}>
              {'Срок изготовления изделий из стекла '}
              <strong>{leadTimeText}</strong>
            </div>
            {notes.map((n, i) => (
              <div key={i} style={S.noteRow}>{n}</div>
            ))}
          </div>

          {/* Right: numbers */}
          <div style={S.numbersCol}>
            <div style={S.subtotalRow}>
              <span>Промежуточный итог</span>
              <span style={S.numVal}>{fmt(subtotal)}</span>
            </div>
            <div style={S.totalRow}>
              <span style={S.totalLbl}>ИТОГО:</span>
              <span style={S.totalVal}>{fmt(grandTotal)}</span>
            </div>
            <div style={S.vatRow}>
              {vatText}
            </div>
          </div>
        </div>

        {/* ══ FOOTER ══ */}
        <div style={S.footer}>
          <div style={S.footerContacts}>
            <span style={S.footerBrand}>M Glass</span>
            {' · '}
            <a href="https://mglass.pro/">mglass.pro</a>
            {' · '}
            8&nbsp;(925)&nbsp;788&nbsp;58&nbsp;37
            {' · '}
            mglass.ceo@gmail.com
          </div>
          <div style={S.footerThanks}>Благодарим за обращение!</div>
        </div>

      </div>
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const DARK   = '#111110'
const MUTED  = '#8a8a85'
const BORDER = '#e2e2de'

const S: Record<string, React.CSSProperties> = {

  center: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', color: MUTED, fontSize: 13, gap: 8,
  },
  spinner: {
    width: 18, height: 18, border: '2px solid #d4d4d0', borderTopColor: MUTED,
    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
  },

  // Screen bar
  bar: {
    position: 'sticky', top: 0, zIndex: 200,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 16px', background: 'rgba(255,255,255,0.97)',
    borderBottom: '1px solid #e2e2de', backdropFilter: 'blur(4px)', gap: 12,
  },
  draftBadge: {
    fontSize: 11, color: '#92400e', background: '#fef3c7',
    border: '1px solid #fde68a', borderRadius: 5, padding: '3px 8px', flexShrink: 0,
  },
  printTip: {
    fontSize: 10, color: MUTED, maxWidth: 340, lineHeight: 1.3,
  },
  btnPrimary: {
    padding: '7px 16px', background: DARK, color: '#fff',
    fontSize: 11, fontWeight: 600, borderRadius: 6, border: 'none', cursor: 'pointer', flexShrink: 0,
  },
  btnSec: {
    padding: '7px 14px', background: '#fff', color: '#555',
    fontSize: 11, border: '1px solid #d4d4d0', borderRadius: 6, cursor: 'pointer', flexShrink: 0,
  },

  // Document sheet
  doc: {
    maxWidth: 760, margin: '20px auto 48px', background: '#fff',
    boxShadow: '0 1px 12px rgba(0,0,0,0.1)', border: `1px solid ${BORDER}`,
  },

  // ── Header ──
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '16px 24px 12px', borderBottom: `2px solid ${DARK}`,
  },
  brandBlock: { display: 'flex', flexDirection: 'column', gap: 3 },
  brandLogo:  { display: 'flex', alignItems: 'center', gap: 8 },
  logoBox: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 28, height: 28, background: DARK, color: '#fff',
    fontSize: 14, fontWeight: 900, borderRadius: 4, flexShrink: 0,
  },
  logoGlass: { fontSize: 18, fontWeight: 900, letterSpacing: 2, color: DARK, fontFamily: 'Georgia, serif' },
  brandSub:  { fontSize: 9, color: MUTED, marginLeft: 36 },
  brandCats: { fontSize: 9, color: MUTED, marginLeft: 36 },

  headerRight: { display: 'flex', gap: 24, alignItems: 'flex-start' },

  contactBlock: { display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' },
  contactLine:  { fontSize: 9, color: MUTED },

  metaBlock: { display: 'flex', flexDirection: 'column', gap: 3 },
  metaRow:   { display: 'flex', gap: 6, alignItems: 'baseline' },
  metaLbl:   { fontSize: 9, color: MUTED, minWidth: 72, textAlign: 'right' },
  metaVal:   { fontSize: 10, fontWeight: 700, color: DARK },

  // ── Title ──
  titleBlock: {
    padding: '12px 24px 10px', borderBottom: `1px solid ${BORDER}`,
    textAlign: 'center',
  },
  titleText: { fontSize: 16, fontWeight: 700, color: DARK, fontFamily: 'Georgia, serif' },

  // ── Client ──
  clientBlock: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '10px 24px 10px', borderBottom: `1px solid ${BORDER}`, gap: 16,
  },
  clientLeft:  { display: 'flex', alignItems: 'baseline', gap: 10 },
  clientLbl:   { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap' },
  clientName:  { fontSize: 13, fontWeight: 700, color: DARK },
  clientRight: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 },
  clientRow:   { display: 'flex', gap: 8, alignItems: 'baseline' },
  clientVal:   { fontSize: 11, fontWeight: 600, color: '#222' },

  // ── Table ──
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    background: DARK, color: '#fff', padding: '7px 10px',
    fontSize: 9, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
    borderRight: '1px solid rgba(255,255,255,0.1)',
  },
  td: { padding: '8px 10px', fontSize: 11, borderRight: `1px solid ${BORDER}` },

  // ── Totals ──
  totalsSection: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '12px 24px 14px', borderTop: `1px solid ${BORDER}`, gap: 24,
  },
  termsCol: { flex: 1, fontSize: 10, color: '#555', lineHeight: 1.7 },
  leadTimeRow: { color: '#333', marginBottom: 4 },
  noteRow: { fontSize: 9, color: '#999', fontStyle: 'italic' },

  numbersCol: { minWidth: 240, flexShrink: 0 },
  subtotalRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 10, color: MUTED, paddingBottom: 6,
    borderBottom: `1px solid ${BORDER}`, marginBottom: 6,
  },
  numVal: { fontVariantNumeric: 'tabular-nums', fontWeight: 600 },

  totalRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 5,
  },
  totalLbl: { fontSize: 12, fontWeight: 700, color: DARK, textTransform: 'uppercase', letterSpacing: 0.5 },
  totalVal: {
    fontSize: 18, fontWeight: 800, color: DARK,
    fontVariantNumeric: 'tabular-nums',
    background: '#f5f0e8', borderRadius: 4,
    padding: '2px 8px',
  },

  vatRow: { fontSize: 9, color: MUTED, textAlign: 'right', fontStyle: 'italic', marginTop: 2 },

  // ── Footer ──
  footer: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 24px 12px', borderTop: `1px solid ${BORDER}`,
  },
  footerContacts: { fontSize: 9, color: MUTED, lineHeight: 1.8 },
  footerBrand:    { fontWeight: 700, color: '#555', fontSize: 10 },
  footerThanks:   { fontSize: 14, fontWeight: 700, color: DARK, fontFamily: 'Georgia, serif' },
}
