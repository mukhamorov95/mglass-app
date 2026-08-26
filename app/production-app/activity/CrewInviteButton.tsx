'use client'

import { useState } from 'react'

// Кнопка «Ссылка для входа» в составе цеха. Нужна потому, что пароли заводились
// автоматически: человек, который ни разу не входил, своего пароля не знает, и
// владелец его тоже не знает. Без ссылки «установить приложение и войти» невыполнимо.
//
// Ссылку владелец не придумывает и пароль не вводит — человек задаёт его сам.
// Показывается кнопка только владельцу, но решает всё серверный гейт
// (requireOwner в /api/admin/invite-link): скрытие в UI — удобство, не защита.

export default function CrewInviteButton({ userId, name }: { userId: string; name: string }) {
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function make() {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/admin/invite-link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.link) { setErr(d.error || 'Не удалось создать ссылку'); return }
      setLink(d.link)
    } catch { setErr('Сеть недоступна') } finally { setBusy(false) }
  }

  async function copy() {
    if (!link) return
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* на некоторых мобильных браузерах буфер закрыт — ссылка видна и выделяется руками */ }
  }

  if (link) {
    return (
      <div className="mt-1.5 w-full rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
        <p className="text-[11px] font-medium text-emerald-800">Ссылка для {name} готова</p>
        <p className="mt-1 break-all font-mono text-[10.5px] text-[#4b4b47] select-all">{link}</p>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={copy} className="rounded-md bg-[#111110] px-2.5 py-1 text-[11px] font-medium text-white">
            {copied ? '✓ Скопировано' : 'Скопировать'}
          </button>
          <span className="text-[10px] text-[#6b6b66]">
            Одноразовая, действует 7 дней. Пароль человек задаёт сам — вам его знать не нужно.
          </span>
        </div>
      </div>
    )
  }

  return (
    <span className="shrink-0">
      <button onClick={make} disabled={busy}
        className="rounded-md border border-[#e4e4e0] px-2 py-0.5 text-[11px] font-medium text-[#6b6b66] hover:border-[#111110] hover:text-[#111110] disabled:opacity-40">
        {busy ? '…' : 'Ссылка для входа'}
      </button>
      {err && <span className="ml-2 text-[10px] text-red-600">{err}</span>}
    </span>
  )
}
