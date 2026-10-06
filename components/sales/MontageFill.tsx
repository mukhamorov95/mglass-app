'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/lib/dialog'

// «Внести из «Монтажей»»: выплата монтажникам из книги «Монтажи» ложится правкой
// приложения (margin_edits) — так же, как если бы её вписали в карточке объекта.
// Книги не меняются, журнал действий пишет автора, правку стирают в карточке.

export type FillItem = { saleId: number; orderNo: string; amount: number }

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const orders = (n: number) => {
  const d = n % 10, h = n % 100
  return d === 1 && h !== 11 ? 'заказ' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'заказа' : 'заказов'
}

async function fillOne(it: FillItem): Promise<string | null> {
  try {
    const r = await fetch('/api/margin/edits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ saleId: it.saleId, set: { installer: it.amount } }),
    })
    if (r.ok) return null
    const j = await r.json().catch(() => ({})) as { error?: string }
    return `${it.orderNo}: ${j.error ?? `ошибка ${r.status}`}`
  } catch (e) {
    return `${it.orderNo}: ${e instanceof Error ? e.message : String(e)}`
  }
}

function useFill() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const run = async (items: FillItem[]) => {
    setBusy(true)
    setMsg(null)
    const errors: string[] = []
    for (const it of items) { const e = await fillOne(it); if (e) errors.push(e) }
    const done = items.length - errors.length
    setMsg(errors.length
      ? { ok: false, text: `Внесено ${done} из ${items.length}. Не вышло: ${errors.join('; ')}` }
      : { ok: true, text: `Внесено ${done}: монтажник теперь в карточке объекта, правка видна в журнале действий` })
    setBusy(false)
    router.refresh()
  }
  return { busy, msg, run }
}

export function MontageFillButton({ item }: { item: FillItem }) {
  const { busy, msg, run } = useFill()
  if (msg?.ok) return <span className="text-[11px] text-emerald-700">✓ внесено</span>
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button disabled={busy} onClick={() => run([item])}
        className="text-[11px] font-medium px-2 py-0.5 rounded-md border border-[#111110] text-[#111110] hover:bg-[#111110] hover:text-white disabled:opacity-40">
        {busy ? 'Вношу…' : `Внести ${rub(item.amount)}`}
      </button>
      {msg && !msg.ok && <span role="alert" className="text-[10px] text-red-700 whitespace-normal">{msg.text}</span>}
    </span>
  )
}

export function MontageFillAll({ items }: { items: FillItem[] }) {
  const { busy, msg, run } = useFill()
  if (!items.length) return null
  const total = items.reduce((a, it) => a + it.amount, 0)
  const ask = async () => {
    const yes = await confirmDialog({
      title: `Внести монтажника из «Монтажей» в ${items.length} ${orders(items.length)}?`,
      text: `Всего ${rub(total)} ₽. Книги «Маржа» и «Монтажи» не меняются — суммы лягут правками приложения, их видно в журнале действий и можно стереть в карточке объекта.`,
      confirmLabel: 'Внести',
    })
    if (yes) await run(items)
  }
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      {/* Кнопка стоит в заголовке сворачиваемого блока: клик не должен его сворачивать. */}
      <button disabled={busy} onClick={e => { e.preventDefault(); e.stopPropagation(); void ask() }}
        className="text-[12px] font-medium px-3 py-1 rounded-lg bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40 whitespace-nowrap">
        {busy ? 'Вношу…' : `Внести из «Монтажей» · ${items.length}`}
      </button>
      {msg && <span role={msg.ok ? undefined : 'alert'} className={`text-[11px] ${msg.ok ? 'text-emerald-700' : 'text-red-700'}`}>{msg.text}</span>}
    </span>
  )
}
