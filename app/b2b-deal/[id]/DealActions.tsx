'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { toast } from '@/lib/toast'
import { promptDialog } from '@/lib/dialog'
import { buildInstallationHref } from '@/components/AssignInstallationButton'
import { buildTelegramWorkText, type TelegramQuote } from '@/lib/b2b/telegramWorkText'
import { duplicateOrder, type DuplicableOrder } from '@/lib/b2b/duplicateOrder'

// Действия над заказом прямо в карточке (У5). Раньше жили только значками в строке
// списка: чтобы отправить клиенту ссылку или скопировать текст для цеха, менеджер
// возвращался в список и искал нужный значок среди одиннадцати.

type Props = {
  dealId: number
  quote: TelegramQuote & DuplicableOrder
  orderTotal: number
  managerName: string | null
}

export default function DealActions({ dealId, quote, orderTotal, managerName }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'share' | 'copy' | 'duplicate' | null>(null)

  async function copyOrShow(value: string, okText: string, title: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success(okText)
    } catch {
      await promptDialog({
        title,
        text: 'Буфер обмена недоступен — текст выделен, скопируйте его (⌘C / Ctrl+C).',
        defaultValue: value, multiline: value.includes('\n'), confirmLabel: 'Готово',
      })
    }
  }

  async function shareLink() {
    setBusy('share')
    try {
      const r = await fetch(`/api/b2b-quotes/${dealId}/share`, { method: 'POST' })
      const j = await r.json().catch(() => ({})) as { url?: string; error?: string }
      if (!r.ok || !j.url) { toast.error('Ссылка на КП не создана', { detail: j.error || `Сервер ответил ${r.status}` }); return }
      await copyOrShow(j.url, 'Ссылка на КП скопирована — можно отправлять клиенту', 'Ссылка на КП для клиента')
    } catch {
      toast.error('Ссылка на КП не создана', { detail: 'Сервер не ответил — проверьте связь' })
    } finally { setBusy(null) }
  }

  async function copyTelegram() {
    setBusy('copy')
    try { await copyOrShow(buildTelegramWorkText(quote), 'Текст для Telegram скопирован', 'Текст для Telegram') }
    finally { setBusy(null) }
  }

  async function duplicate() {
    setBusy('duplicate')
    try {
      const { data, error } = await duplicateOrder(createClient(), quote, { managerName })
      if (error || !data) { toast.error('Копия не создана', error ? { detail: error } : undefined); return }
      const newId = Number(data.id)
      toast.success('Создан черновик — копия этого заказа', {
        action: { label: 'Открыть', onClick: () => router.push(`/b2b-deal/${newId}`) },
      })
    } finally { setBusy(null) }
  }

  const btn = 'px-3 py-1.5 rounded-xl border border-[#e4e4e0] text-[12px] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40 transition-colors'

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={shareLink} disabled={busy !== null} className={btn}>
        {busy === 'share' ? '🔗 Готовлю ссылку…' : '🔗 Ссылка клиенту'}
      </button>
      <button onClick={copyTelegram} disabled={busy !== null} className={btn}>✈️ Текст для Telegram</button>
      <Link href={`/calculator/b2b?orderId=${dealId}`} className={btn}>🧮 Открыть в калькуляторе</Link>
      <Link href={buildInstallationHref({ orderNo: quote.custom_number, clientName: quote.client_name, orderTotal })} className={btn}>
        🔧 Назначить монтаж
      </Link>
      <button onClick={duplicate} disabled={busy !== null} className={btn}>
        {busy === 'duplicate' ? '⧉ Копирую…' : '⧉ Дублировать как черновик'}
      </button>
    </div>
  )
}
