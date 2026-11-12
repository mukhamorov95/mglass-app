'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog, promptDialog } from '@/lib/dialog'
import { toast, responseError, NETWORK_ERROR } from '@/lib/toast'
import { ownCostRemakeLabel, type OwnCostRemake } from '@/lib/b2b/ownCostRemake'

// Отметка «за счёт M GLASS»: заказ остаётся со своей суммой, но клиенту не выставляется и в долг не входит.
export default function OwnCostToggle({ dealId, number, mark, suggestedOf, canEdit }: {
  dealId: number; number: string; mark: OwnCostRemake | null; suggestedOf: string | null; canEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const stamp = mark?.at ? new Date(mark.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

  async function send(on: boolean, of: string | null) {
    setBusy(true)
    try {
      const r = await fetch(`/api/b2b-orders/${dealId}/own-cost`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on, of }) })
        .catch(() => { throw new Error(NETWORK_ERROR) })
      if (!r.ok) throw new Error(await responseError(r))
      toast.success(on ? `№ ${number}: за счёт M GLASS` : `№ ${number}: снова за счёт клиента`, {
        detail: on ? 'Сумма заказа осталась, в долг клиента и акт сверки он больше не входит.' : 'Заказ снова входит в долг клиента.',
      })
      router.refresh()
    } catch (e) {
      toast.error('Отметка не записана', { detail: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  async function turnOn() {
    const of = await promptDialog({
      title: `№ ${number} за счёт M GLASS`,
      text: 'Переделка по нашей вине: сумма заказа останется, но клиенту он не выставляется и в долг не входит. Переделку, которую запустил сам клиент, он оплачивает — её не отмечайте. Какой заказ переделываем?',
      defaultValue: suggestedOf ?? '',
      placeholder: 'Номер исходного заказа, можно пусто',
      confirmLabel: 'Отметить',
    })
    if (of === null) return
    await send(true, of.trim() || null)
  }

  async function turnOff() {
    const ok = await confirmDialog({ title: `Снять «за счёт M GLASS» с № ${number}?`, text: 'Заказ снова войдёт в долг клиента и в акт сверки.', confirmLabel: 'Снять' })
    if (ok) await send(false, null)
  }

  if (!mark && !canEdit) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mark && (
        <span className="text-[12px] font-semibold px-3 py-1.5 rounded-xl bg-[#eef2fb] text-[#3a55a0] border border-[#d5def3]">
          {ownCostRemakeLabel(mark)} · клиенту не выставляется{mark.by ? ` · отметил ${mark.by}` : ''}{stamp ? `, ${stamp}` : ''}
        </span>
      )}
      {canEdit && (
        <button disabled={busy} onClick={mark ? turnOff : turnOn}
          className="text-[12px] px-3 py-1.5 rounded-xl border border-[#e4e4e0] text-[#4b4b47] hover:bg-[#f5f5f3] disabled:opacity-50">
          {busy ? 'Записываю…' : mark ? 'Снять «за счёт M GLASS»' : 'За счёт M GLASS'}
        </button>
      )}
    </div>
  )
}
