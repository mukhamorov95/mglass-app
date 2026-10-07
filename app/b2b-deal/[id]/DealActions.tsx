'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'
import { toast } from '@/lib/toast'
import { buildInstallationHref } from '@/components/AssignInstallationButton'
import { buildTelegramWorkText, type TelegramQuote } from '@/lib/b2b/telegramWorkText'
import { duplicateOrder, type DuplicableOrder } from '@/lib/b2b/duplicateOrder'
import { copyOrShow as copyText } from '@/lib/b2b/copyOrShow'
import { buildProductionMessage, productionMessageSummary } from '@/lib/b2b/productionMessage'
import { PAYMENT_REMINDER_LABEL } from '@/lib/b2b/clientTexts'
import LaunchPanel from '@/components/b2b/LaunchPanel'

// Действия над заказом прямо в карточке (У5). Раньше жили только значками в строке
// списка: чтобы отправить клиенту ссылку или скопировать текст для цеха, менеджер
// возвращался в список и искал нужный значок среди одиннадцати.

type Props = {
  dealId: number
  quote: TelegramQuote & DuplicableOrder
  orderTotal: number
  managerName: string | null
  launched: boolean
  productionDays: number | null
  phone: string | null          // телефон клиента — ссылкой tel:, звонок в одно касание
  contactName: string | null
  payReminder: string | null    // готовый текст «напомнить об оплате»; null — оплачено или нечего напоминать
}

export default function DealActions({ dealId, quote, orderTotal, managerName, launched, productionDays, phone, contactName, payReminder }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<'share' | 'copy' | 'duplicate' | null>(null)
  const [launchOpen, setLaunchOpen] = useState(false)

  const copyOrShow = (value: string, okText: string, title: string) => copyText(value, { ok: okText, title })

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

  // После запуска — сразу следующий шаг: производственное сообщение в чат цеха.
  function onLaunched(columns: Record<string, unknown>, tasksOk: boolean) {
    setLaunchOpen(false)
    const msgOrder = { ...quote, ...(columns as Partial<typeof quote>) }
    toast.success('Запущено в работу', {
      detail: tasksOk ? 'Задачи цеху созданы. Отправьте производственное сообщение в рабочий чат.' : 'Задачи цеху не создались — повторите из сообщения об ошибке.',
      action: {
        label: '📋 Произв. сообщение',
        onClick: () => { void copyText(buildProductionMessage(msgOrder), { ok: 'Производственное сообщение скопировано', title: 'Скопируйте производственное сообщение', detail: productionMessageSummary(msgOrder) }) },
      },
      durationMs: 15000,
    })
    router.refresh()
  }

  const btn = 'px-3 py-1.5 rounded-xl border border-[#e4e4e0] text-[12px] text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40 transition-colors'
  const primary = 'px-3 py-1.5 rounded-xl bg-[#111110] text-white text-[12px] font-semibold hover:bg-[#2a2a28] disabled:opacity-40 transition-colors'
  const tel = phone ? phone.replace(/[^\d+]/g, '') : ''

  return (
    <div className="space-y-2">
    <div className="flex flex-wrap gap-2">
      {!launched && (quote.client_id == null ? (
        <Link href={`/calculator/b2b?orderId=${dealId}`} className={primary}
          title="Без заказчика в работу нельзя: выберите или создайте клиента и нажмите «Обновить просчёт»">
          ＋ Заказчик →
        </Link>
      ) : (
        <button onClick={() => setLaunchOpen(o => !o)} className={primary}>▶ Запустить в работу</button>
      ))}
      {tel && (
        <a href={`tel:${tel}`} className={btn} title={contactName ? `Позвонить: ${contactName}` : 'Позвонить клиенту'}>
          📞 {phone}{contactName ? ` · ${contactName}` : ''}
        </a>
      )}
      {payReminder && (
        <button onClick={() => { void copyOrShow(payReminder, 'Напоминание об оплате скопировано', 'Текст клиенту: оплата') }} className={btn}>
          {PAYMENT_REMINDER_LABEL}
        </button>
      )}
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
    {launchOpen && !launched && (
      <div className="rounded-xl overflow-hidden border border-[#d0e0ff]">
        <LaunchPanel orderId={dealId} initialNumber={quote.custom_number ?? null} productionDays={productionDays}
          onLaunched={res => onLaunched(res.saved.columns, res.tasksOk)} onCancel={() => setLaunchOpen(false)} />
      </div>
    )}
    </div>
  )
}
