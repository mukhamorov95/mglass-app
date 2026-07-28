'use client'

import Link from 'next/link'

// Кнопка «Назначить монтаж» на карточках заказа/КП. Не плодит новую форму —
// открывает существующую богатую заявку /installations, предзаполненную из
// заказа (клиент, телефон, адрес, №, сумма). Дальше монтаж пишется в таблицу
// installations и виден во внутреннем /calendar.

type Props = {
  orderNo?: string | null
  clientName?: string | null
  phone?: string | null
  address?: string | null
  orderTotal?: number | string | null
  title?: string | null
  className?: string
  label?: string
}

export function buildInstallationHref(p: Props): string {
  const q = new URLSearchParams()
  const add = (k: string, v: unknown) => {
    if (v == null) return
    const s = String(v).trim()
    if (s) q.set(k, s)
  }
  add('order_no', p.orderNo ? String(p.orderNo).replace(/^#/, '') : null)
  add('client_name', p.clientName)
  add('phone', p.phone)
  add('address', p.address)
  add('order_total', p.orderTotal != null && p.orderTotal !== '' ? p.orderTotal : null)
  add('title', p.title)
  const qs = q.toString()
  return '/installations' + (qs ? `?${qs}` : '')
}

export default function AssignInstallationButton(props: Props) {
  const cls = props.className ??
    'inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:border-[#111110] transition-colors'
  return (
    <Link href={buildInstallationHref(props)} className={cls}>
      {props.label ?? '🔧 Назначить монтаж'}
    </Link>
  )
}
