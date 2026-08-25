import { redirect } from 'next/navigation'

// Критические остатки — теперь фильтр «только дефицит» в разделе «Склад».
export default function StockControlRedirect() {
  redirect('/inventory')
}
