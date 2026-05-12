import React from 'react'
import {
  Document, Page, View, Text, StyleSheet,
} from '@react-pdf/renderer'

const BRAND = '#111110'
const MUTED  = '#8a8a85'
const BORDER = '#e4e4e0'
const ACCENT = '#2563eb'

const s = StyleSheet.create({
  page:       { fontFamily: 'Helvetica', fontSize: 9, color: BRAND, padding: '32 40 40 40', backgroundColor: '#ffffff' },

  // Header
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  brandBlock: { flexDirection: 'column', gap: 2 },
  brandName:  { fontSize: 16, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  brandSub:   { fontSize: 8, color: MUTED },
  metaBlock:  { alignItems: 'flex-end', gap: 2 },
  metaLabel:  { fontSize: 8, color: MUTED },
  metaValue:  { fontSize: 9, fontFamily: 'Helvetica-Bold' },

  // Title bar
  titleBar:   { backgroundColor: BRAND, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 16 },
  titleText:  { color: '#ffffff', fontFamily: 'Helvetica-Bold', fontSize: 11, letterSpacing: 0.8 },

  // Client block
  section:    { marginBottom: 14 },
  sectionLbl: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  clientRow:  { flexDirection: 'row', gap: 24 },
  clientCell: { flex: 1 },
  cellLabel:  { fontSize: 7, color: MUTED, marginBottom: 2 },
  cellValue:  { fontSize: 9, fontFamily: 'Helvetica-Bold' },

  // Table
  table:      { borderRadius: 4, overflow: 'hidden', marginBottom: 14 },
  thead:      { flexDirection: 'row', backgroundColor: '#f8f8f7', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 5, paddingHorizontal: 8 },
  theadTxt:   { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'Helvetica-Bold' },
  trow:       { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f4f4f2' },
  trowAlt:    { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f4f4f2', backgroundColor: '#fafaf9' },

  // Columns widths (total ~100%)
  c0: { width: '4%' },
  c1: { width: '28%' },
  c2: { width: '15%' },
  c3: { width: '7%' },
  c4: { width: '10%' },
  c5: { width: '18%' },
  c6: { width: '18%' },

  txtR:   { textAlign: 'right' },
  bold:   { fontFamily: 'Helvetica-Bold' },
  mono:   { fontFamily: 'Courier' },

  // Totals
  totalsBox: { alignSelf: 'flex-end', width: 240, marginBottom: 20 },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totBorder: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 6 },

  // Footer
  footerDivider: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 12, paddingTop: 10 },
  footerRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt:     { fontSize: 7, color: MUTED, lineHeight: 1.5 },
  footerBold:    { fontSize: 7, color: BRAND, fontFamily: 'Helvetica-Bold' },

  validityBox:   { backgroundColor: '#f0fdf4', borderRadius: 4, padding: '6 10', marginBottom: 14, flexDirection: 'row', gap: 6, alignItems: 'center' },
  validityTxt:   { fontSize: 8, color: '#166534' },
})

export type QuotePDFProps = {
  id: number
  clientName: string
  contact: string | null
  phone: string | null
  discountPercent: number
  items: {
    materialName?: string
    category?: string
    thickness?: number
    width?: number
    height?: number
    quantity?: number
    totalAreaNet?: number
    saleIncVat?: number
    hasTempering?: boolean
    comment?: string
  }[]
  totalSaleIncVat: number
  totalAfterDiscount: number
  managerName: string | null
  productionDays: number
  quoteDate: string
  userNotes: string | null
}

function fmt(n: number) {
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽'
}
function fmtN(n: number, d = 3) {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: d })
}

export default function QuotePDF(p: QuotePDFProps) {
  const date = new Date(p.quoteDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const validUntil = new Date(new Date(p.quoteDate).getTime() + 14 * 86_400_000)
    .toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const hasDiscount = p.discountPercent > 0

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.headerRow}>
          <View style={s.brandBlock}>
            <Text style={s.brandName}>MGlass</Text>
            <Text style={s.brandSub}>Стекло · Зеркала · Душевые ограждения</Text>
            <Text style={s.brandSub}>Москва · mglass.ru</Text>
          </View>
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>КП №</Text>
            <Text style={s.metaValue}>{String(p.id).padStart(5, '0')}</Text>
            <Text style={[s.metaLabel, { marginTop: 4 }]}>Дата</Text>
            <Text style={s.metaValue}>{date}</Text>
          </View>
        </View>

        {/* Title */}
        <View style={s.titleBar}>
          <Text style={s.titleText}>КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ</Text>
        </View>

        {/* Client */}
        <View style={s.section}>
          <Text style={s.sectionLbl}>Клиент</Text>
          <View style={s.clientRow}>
            <View style={s.clientCell}>
              <Text style={s.cellLabel}>Организация / ИП</Text>
              <Text style={s.cellValue}>{p.clientName}</Text>
            </View>
            {p.contact && (
              <View style={s.clientCell}>
                <Text style={s.cellLabel}>Контакт</Text>
                <Text style={s.cellValue}>{p.contact}</Text>
              </View>
            )}
            {p.phone && (
              <View style={s.clientCell}>
                <Text style={s.cellLabel}>Телефон</Text>
                <Text style={[s.cellValue, s.mono]}>{p.phone}</Text>
              </View>
            )}
            {hasDiscount && (
              <View style={s.clientCell}>
                <Text style={s.cellLabel}>Персональная скидка</Text>
                <Text style={[s.cellValue, { color: '#059669' }]}>{p.discountPercent}%</Text>
              </View>
            )}
          </View>
        </View>

        {/* Items table */}
        <View style={s.section}>
          <Text style={s.sectionLbl}>Состав заказа</Text>
          <View style={s.table}>
            {/* Head */}
            <View style={s.thead}>
              <Text style={[s.theadTxt, s.c0]}>#</Text>
              <Text style={[s.theadTxt, s.c1]}>Материал</Text>
              <Text style={[s.theadTxt, s.c2]}>Размер (мм)</Text>
              <Text style={[s.theadTxt, s.c3, s.txtR]}>Кол.</Text>
              <Text style={[s.theadTxt, s.c4, s.txtR]}>м²</Text>
              <Text style={[s.theadTxt, s.c5, s.txtR]}>Цена / ед.</Text>
              <Text style={[s.theadTxt, s.c6, s.txtR]}>Сумма</Text>
            </View>
            {/* Rows */}
            {p.items.map((item, idx) => {
              const qty   = item.quantity ?? 1
              const area  = item.totalAreaNet ?? 0
              const price = item.saleIncVat ?? 0
              const total = price * qty
              const row   = idx % 2 === 0 ? s.trow : s.trowAlt
              const desc  = [item.materialName, item.thickness ? `${item.thickness}мм` : null]
                .filter(Boolean).join(', ')
              const temper = item.hasTempering ? ' [закалка]' : ''
              const size  = (item.width && item.height)
                ? `${item.width} × ${item.height}`
                : '—'
              return (
                <View key={idx} style={row}>
                  <Text style={[s.c0, { color: MUTED }]}>{idx + 1}</Text>
                  <Text style={s.c1}>{desc}{temper}{item.comment ? `\n${item.comment}` : ''}</Text>
                  <Text style={[s.c2, s.mono]}>{size}</Text>
                  <Text style={[s.c3, s.txtR, s.mono]}>{qty}</Text>
                  <Text style={[s.c4, s.txtR, s.mono]}>{fmtN(area)}</Text>
                  <Text style={[s.c5, s.txtR, s.mono]}>{fmt(price)}</Text>
                  <Text style={[s.c6, s.txtR, s.bold, s.mono]}>{fmt(total)}</Text>
                </View>
              )
            })}
          </View>
        </View>

        {/* Totals */}
        <View style={s.totalsBox}>
          <View style={s.totRow}>
            <Text style={{ color: MUTED }}>Сумма без скидки</Text>
            <Text style={s.mono}>{fmt(p.totalSaleIncVat)}</Text>
          </View>
          {hasDiscount && (
            <View style={s.totRow}>
              <Text style={{ color: MUTED }}>Скидка {p.discountPercent}%</Text>
              <Text style={[s.mono, { color: '#059669' }]}>
                − {fmt(p.totalSaleIncVat - p.totalAfterDiscount)}
              </Text>
            </View>
          )}
          <View style={[s.totRow, s.totBorder]}>
            <Text style={s.bold}>Итого с НДС</Text>
            <Text style={[s.bold, s.mono, { fontSize: 11 }]}>{fmt(p.totalAfterDiscount)}</Text>
          </View>
        </View>

        {/* Validity */}
        <View style={s.validityBox}>
          <Text style={s.validityTxt}>
            КП действительно до {validUntil} · Срок изготовления: {p.productionDays} рабочих дней
          </Text>
        </View>

        {p.userNotes && (
          <View style={[s.section, { backgroundColor: '#fafaf9', borderRadius: 4, padding: '6 10', marginBottom: 14 }]}>
            <Text style={s.sectionLbl}>Примечание</Text>
            <Text style={{ fontSize: 8, lineHeight: 1.5 }}>{p.userNotes}</Text>
          </View>
        )}

        {/* Footer */}
        <View style={s.footerDivider}>
          <View style={s.footerRow}>
            <View>
              <Text style={s.footerBold}>MGlass</Text>
              <Text style={s.footerTxt}>Производство и монтаж стеклянных изделий</Text>
              <Text style={s.footerTxt}>г. Москва · mglass.ru</Text>
            </View>
            {p.managerName && (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.footerBold}>Менеджер</Text>
                <Text style={s.footerTxt}>{p.managerName}</Text>
              </View>
            )}
          </View>
        </View>

      </Page>
    </Document>
  )
}
