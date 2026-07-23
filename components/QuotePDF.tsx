import React from 'react'
import {
  Document, Page, View, Text, StyleSheet, Font,
} from '@react-pdf/renderer'
import path from 'path'

Font.register({
  family: 'PTSans',
  fonts: [
    { src: path.join(process.cwd(), 'public', 'fonts', 'PTSans-Regular.ttf'), fontWeight: 'normal' },
    { src: path.join(process.cwd(), 'public', 'fonts', 'PTSans-Bold.ttf'),    fontWeight: 'bold' },
  ],
})

const BRAND = '#111110'
const MUTED  = '#8a8a85'
const BORDER = '#e4e4e0'

const s = StyleSheet.create({
  page:       { fontFamily: 'PTSans', fontWeight: 'normal', fontSize: 9, color: BRAND, padding: '32 40 40 40', backgroundColor: '#ffffff' },

  // Header
  headerRow:  { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  brandBlock: { flexDirection: 'column', gap: 2 },
  brandName:  { fontSize: 16, fontFamily: 'PTSans', fontWeight: 'bold', letterSpacing: 0.5 },
  brandSub:   { fontSize: 8, color: MUTED },
  metaBlock:  { alignItems: 'flex-end', gap: 2 },
  metaLabel:  { fontSize: 8, color: MUTED },
  metaValue:  { fontSize: 9, fontFamily: 'PTSans', fontWeight: 'bold' },

  // Title bar
  titleBar:   { backgroundColor: BRAND, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 14, marginBottom: 16 },
  titleText:  { color: '#ffffff', fontFamily: 'PTSans', fontWeight: 'bold', fontSize: 11, letterSpacing: 0.8 },

  // Client block
  section:    { marginBottom: 14 },
  sectionLbl: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
  clientRow:  { flexDirection: 'row', gap: 24 },
  clientCell: { flex: 1 },
  cellLabel:  { fontSize: 7, color: MUTED, marginBottom: 2 },
  cellValue:  { fontSize: 9, fontFamily: 'PTSans', fontWeight: 'bold' },

  // Table
  table:      { borderRadius: 4, overflow: 'hidden', marginBottom: 14 },
  thead:      { flexDirection: 'row', backgroundColor: '#f8f8f7', borderBottomWidth: 1, borderBottomColor: BORDER, paddingVertical: 5, paddingHorizontal: 8 },
  theadTxt:   { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, fontFamily: 'PTSans', fontWeight: 'bold' },
  trow:       { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f4f4f2' },
  trowAlt:    { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f4f4f2', backgroundColor: '#fafaf9' },

  // Column widths (total ~100%)
  c0: { width: '4%' },
  c1: { width: '36%' },
  c2: { width: '20%' },
  c3: { width: '8%' },
  c4: { width: '12%' },
  c5: { width: '20%' },

  txtR:  { textAlign: 'right' },
  bold:  { fontFamily: 'PTSans', fontWeight: 'bold' },

  // Totals
  totalsBox: { alignSelf: 'flex-end', width: 240, marginBottom: 20 },
  totRow:    { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  totBorder: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 4, paddingTop: 6 },

  // Footer
  footerDivider: { borderTopWidth: 1, borderTopColor: BORDER, marginTop: 12, paddingTop: 10 },
  footerRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  footerTxt:     { fontSize: 7, color: MUTED, lineHeight: 1.5 },
  footerBold:    { fontSize: 7, color: BRAND, fontFamily: 'PTSans', fontWeight: 'bold' },

  validityBox: { backgroundColor: '#f0fdf4', borderRadius: 4, padding: '6 10', marginBottom: 14 },
  validityTxt: { fontSize: 8, color: '#166534' },
})

export type QuotePDFProps = {
  id: number
  customNumber?: string | null
  clientOrderNumber?: string | null
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
    services?: { name: string; cost: number }[]
  }[]
  totalSaleIncVat: number
  totalAfterDiscount: number
  totalArea: number
  totalWeight: number
  managerName: string | null
  productionDays: number
  quoteDate: string
  userNotes: string | null
  // 'consolidated' (по умолчанию) — клиенту показываем только итог одной суммой,
  // построчные цены материала и услуг скрыты. 'detailed' — полная разбивка.
  priceMode?: 'consolidated' | 'detailed'
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
  const showPrices = p.priceMode === 'detailed'
  // Ширины колонок: со «Суммой» (detailed) и без неё (consolidated — 20% отдаём
  // «Материалу» и «Размеру», чтобы таблица не оставляла пустоту справа).
  const W = showPrices
    ? { c0: '4%', c1: '36%', c2: '20%', c3: '8%', c4: '12%', c5: '20%' }
    : { c0: '4%', c1: '48%', c2: '28%', c3: '8%', c4: '12%', c5: '0%' }

  return (
    <Document>
      <Page size="A4" style={s.page}>

        {/* Header */}
        <View style={s.headerRow}>
          <View style={s.brandBlock}>
            <Text style={s.brandName}>MGlass</Text>
            <Text style={s.brandSub}>{'Стекло · Зеркала · Душевые ограждения'}</Text>
            <Text style={s.brandSub}>{'Москва · mglass.ru'}</Text>
          </View>
          <View style={s.metaBlock}>
            <Text style={s.metaLabel}>КП №</Text>
            <Text style={s.metaValue}>{p.customNumber?.trim() || String(p.id).padStart(5, '0')}</Text>
            {p.clientOrderNumber && (
              <Text style={[s.metaLabel, { marginTop: 2 }]}>№ клиента: {p.clientOrderNumber}</Text>
            )}
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
                <Text style={s.cellValue}>{p.phone}</Text>
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
            <View style={s.thead}>
              <Text style={[s.theadTxt, { width: W.c0 }]}>#</Text>
              <Text style={[s.theadTxt, { width: W.c1 }]}>Материал</Text>
              <Text style={[s.theadTxt, { width: W.c2 }]}>Размер (мм)</Text>
              <Text style={[s.theadTxt, { width: W.c3 }, s.txtR]}>Кол.</Text>
              <Text style={[s.theadTxt, { width: W.c4 }, s.txtR]}>м²</Text>
              {showPrices && <Text style={[s.theadTxt, { width: W.c5 }, s.txtR]}>Сумма</Text>}
            </View>
            {p.items.map((item, idx) => {
              const qty      = item.quantity ?? 1
              const area     = item.totalAreaNet ?? 0
              const svcs     = item.services ?? []
              const svcTotal = svcs.reduce((sum, sv) => sum + (sv.cost ?? 0), 0)
              const itemTotal = item.saleIncVat ?? 0
              const matTotal  = itemTotal - svcTotal  // material-only portion
              const row       = idx % 2 === 0 ? s.trow : s.trowAlt
              const svcRow    = idx % 2 === 0
                ? { ...s.trow, paddingTop: 2, paddingBottom: 3 }
                : { ...s.trowAlt, paddingTop: 2, paddingBottom: 3 }
              const desc  = [item.materialName, item.thickness ? `${item.thickness}мм` : null]
                .filter(Boolean).join(', ')
              const temper = item.hasTempering ? ' [закалка]' : ''
              const size  = (item.width && item.height) ? `${item.width} × ${item.height}` : '—'
              return (
                <React.Fragment key={idx}>
                  <View style={row}>
                    <Text style={[{ width: W.c0 }, { color: MUTED }]}>{idx + 1}</Text>
                    <Text style={{ width: W.c1 }}>{desc}{temper}{item.comment ? `\n${item.comment}` : ''}</Text>
                    <Text style={{ width: W.c2 }}>{size}</Text>
                    <Text style={[{ width: W.c3 }, s.txtR]}>{qty}</Text>
                    <Text style={[{ width: W.c4 }, s.txtR]}>{fmtN(area)}</Text>
                    {showPrices && <Text style={[{ width: W.c5 }, s.txtR, s.bold]}>{fmt(svcs.length > 0 ? matTotal : itemTotal)}</Text>}
                  </View>
                  {svcs.map((svc, si) => (
                    <View key={`svc-${idx}-${si}`} style={svcRow}>
                      <Text style={{ width: W.c0 }} />
                      <Text style={[{ width: W.c1 }, { color: MUTED, fontSize: 8 }]}>  ↳ {svc.name}</Text>
                      <Text style={{ width: W.c2 }} />
                      <Text style={{ width: W.c3 }} />
                      <Text style={{ width: W.c4 }} />
                      {showPrices && <Text style={[{ width: W.c5 }, s.txtR, { color: MUTED, fontSize: 8 }]}>{fmt(svc.cost ?? 0)}</Text>}
                    </View>
                  ))}
                </React.Fragment>
              )
            })}
          </View>
        </View>

        {/* Totals */}
        <View style={s.totalsBox}>
          <View style={s.totRow}>
            <Text style={{ color: MUTED }}>Сумма без скидки</Text>
            <Text>{fmt(p.totalSaleIncVat)}</Text>
          </View>
          {hasDiscount && (
            <View style={s.totRow}>
              <Text style={{ color: MUTED }}>Скидка {p.discountPercent}%</Text>
              <Text style={{ color: '#059669' }}>
                {'−'} {fmt(p.totalSaleIncVat - p.totalAfterDiscount)}
              </Text>
            </View>
          )}
          <View style={[s.totRow, s.totBorder]}>
            <Text style={s.bold}>Итого с НДС</Text>
            <Text style={[s.bold, { fontSize: 11 }]}>{fmt(p.totalAfterDiscount)}</Text>
          </View>
          <View style={[s.totRow, { marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: BORDER }]}>
            <Text style={{ color: MUTED }}>Площадь</Text>
            <Text>{fmtN(p.totalArea)} м²</Text>
          </View>
          <View style={s.totRow}>
            <Text style={{ color: MUTED }}>Вес</Text>
            <Text>{fmtN(p.totalWeight, 1)} кг</Text>
          </View>
          <View style={s.totRow}>
            <Text style={{ color: MUTED }}>Позиций</Text>
            <Text>{p.items.length}</Text>
          </View>
        </View>

        {/* Validity */}
        <View style={s.validityBox}>
          <Text style={s.validityTxt}>
            КП действительно до {validUntil} {'·'} Срок изготовления: {p.productionDays} рабочих дней
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
              <Text style={s.footerTxt}>{'г. Москва · mglass.ru'}</Text>
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
