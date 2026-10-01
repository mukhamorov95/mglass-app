'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { confirmDialog } from '@/lib/dialog'
import { toast, responseError, NETWORK_ERROR } from '@/lib/toast'

// Выдача доступа в кабинет заказчику. Владелец создаёт учётку партнёру, привязывает
// к карточке клиента и отдаёт ссылку на установку пароля. API сам проверяет права.

type Row = { id: number; name: string; discount: number; active: boolean; isPoint: boolean; linked: boolean; email: string | null }

export default function B2BAccessPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [grantId, setGrantId] = useState<number | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [emailed, setEmailed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [pointBusy, setPointBusy] = useState<number | null>(null)

  async function load() {
    try {
      const r = await fetch('/api/admin/b2b-access')
      if (!r.ok) { setLoadErr(await responseError(r)); return }
      const d = await r.json()
      setLoadErr(null)
      setRows(d.clients ?? [])
    } catch { setLoadErr(NETWORK_ERROR) }
  }

  async function togglePoint(r: Row) {
    const next = !r.isPoint
    const ok = await confirmDialog(next
      ? {
          title: `Отметить «${r.name}» как точку на рынке?`,
          text: 'Цех увидит у заказов пометку «Точка» и будет делать их первыми. В работу такой заказ уйдёт только после 100 % оплаты: менеджер отмечает «Оплачен», потом запускает.',
          confirmLabel: 'Отметить точкой',
        }
      : {
          title: `Снять признак точки с «${r.name}»?`,
          text: 'Заказы перестанут подниматься первыми в цеху, и правило 100 % предоплаты для них снимется.',
          confirmLabel: 'Снять признак',
          danger: true,
        })
    if (!ok) return
    setPointBusy(r.id)
    try {
      const res = await fetch('/api/admin/b2b-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_point', clientId: r.id, value: next }),
      })
      if (!res.ok) { toast.error('Признак точки не сохранён', { detail: await responseError(res) }); return }
      setRows(prev => prev.map(x => x.id === r.id ? { ...x, isPoint: next } : x))
      toast.success(next ? `«${r.name}» — точка на рынке` : `«${r.name}» больше не точка`)
    } catch {
      toast.error('Признак точки не сохранён', { detail: NETWORK_ERROR })
    } finally { setPointBusy(null) }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load().finally(() => setLoading(false)) }, [])

  async function grant(clientId: number) {
    setErr(null); setLink(null)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErr('Введите корректный email'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/b2b-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, email: email.trim() }),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'Ошибка'); return }
      setLink(d.link); setEmailed(!!d.emailed); setGrantId(null); setEmail('')
      await load()
    } catch { setErr('Сеть недоступна') } finally { setBusy(false) }
  }
  async function unlink(clientId: number) {
    if (!confirm('Отозвать доступ этого клиента к кабинету?')) return
    setBusy(true)
    try {
      await fetch('/api/admin/b2b-access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink', clientId }),
      })
      await load()
    } finally { setBusy(false) }
  }
  async function preview(clientId: number) {
    setBusy(true)
    try {
      const res = await fetch('/api/partner/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }) })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { alert(d.error || 'Не удалось включить просмотр'); return }
      window.location.href = '/partner'
    } finally { setBusy(false) }
  }
  function copy(text: string) { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) }

  const filtered = rows.filter(r => r.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-bold text-[#111110] tracking-tight">Доступ в кабинет заказчика</h1>
          <p className="text-[12.5px] text-[#9a9a95] mt-0.5">Создайте партнёру логин и привяжите к его компании. Пароль клиент задаёт сам.</p>
        </div>
        <Link href="/admin" className="text-[12px] text-[#9a9a95] hover:text-[#111110]">← Админ</Link>
      </div>

      <div className="max-w-[820px] mx-auto px-4 pt-4">
        {link && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-3">
            <p className="text-[13px] font-semibold text-emerald-800">Доступ выдан.{emailed ? ' Клиенту отправлено письмо со ссылкой на пароль.' : ' Отправьте клиенту ссылку для установки пароля:'}</p>
            <div className="flex items-center gap-2 mt-2">
              <input readOnly value={link} className="flex-1 bg-white border border-emerald-200 rounded-lg px-2.5 py-2 text-[12px] font-mono text-[#111110]" />
              <button onClick={() => copy(link)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700">{copied ? 'Скопировано ✓' : 'Копировать'}</button>
            </div>
            <p className="text-[11px] text-emerald-700 mt-1.5">Ссылка одноразовая, действует 7 дней.</p>
          </div>
        )}

        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск клиента…"
          className="w-full bg-white border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110] mb-2" />

        {loading ? (
          <div className="text-[13px] text-[#9a9a95] py-8 text-center">Загрузка…</div>
        ) : loadErr ? (
          <div className="bg-white rounded-xl border border-red-200 px-4 py-6 text-center">
            <p className="text-[13px] text-red-600">Список клиентов не загрузился: {loadErr}</p>
            <button onClick={() => { setLoading(true); load().finally(() => setLoading(false)) }}
              className="mt-2 text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#111110] hover:border-[#111110]">Повторить</button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#e4e4e0] divide-y divide-[#f0f0ec]">
            {filtered.map(r => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#111110] truncate">{r.name} <span className="text-[#9a9a95] font-normal">· скидка {r.discount}%</span></p>
                    {r.linked
                      ? <p className="text-[12px] text-emerald-700 mt-0.5">✓ Доступ выдан{r.email ? ` · ${r.email}` : ''}</p>
                      : <p className="text-[12px] text-[#9a9a95] mt-0.5">Доступа нет</p>}
                    <button onClick={() => togglePoint(r)} disabled={pointBusy === r.id}
                      title="Точка на стройрынке: заказы цех делает первыми, в работу — только после 100 % оплаты"
                      className={`mt-1 text-[11px] rounded-full px-2 py-0.5 border transition-colors disabled:opacity-50 ${r.isPoint ? 'text-sky-800 bg-sky-50 border-sky-300 hover:bg-sky-100' : 'text-[#9a9a95] bg-[#f8f8f7] border-[#e4e4e0] hover:border-[#c4c4be]'}`}>
                      {pointBusy === r.id ? 'Сохраняю…' : r.isPoint ? 'Точка на рынке: да' : 'Точка на рынке: нет'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => preview(r.id)} disabled={busy} title="Открыть кабинет глазами этого клиента — только просмотр"
                      className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#111110] hover:border-[#111110]">👁 Смотреть как партнёр</button>
                    {r.linked ? (
                      <button onClick={() => unlink(r.id)} disabled={busy}
                        className="text-[12px] px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[#9a9a95] hover:text-red-600 hover:border-red-300">Отозвать</button>
                    ) : grantId === r.id ? (
                      <>
                        <input autoFocus value={email} onChange={e => setEmail(e.target.value)} placeholder="email клиента"
                          onKeyDown={e => { if (e.key === 'Enter') grant(r.id) }}
                          className="bg-[#f8f8f7] border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[12px] outline-none focus:border-[#111110] w-44" />
                        <button onClick={() => grant(r.id)} disabled={busy}
                          className="text-[12px] px-3 py-1.5 rounded-lg bg-[#1d1d1f] text-white font-semibold hover:bg-black disabled:opacity-40">{busy ? '…' : 'Выдать'}</button>
                        <button onClick={() => { setGrantId(null); setErr(null) }} className="text-[12px] text-[#9a9a95] px-1">✕</button>
                      </>
                    ) : (
                      <button onClick={() => { setGrantId(r.id); setEmail(''); setErr(null); setLink(null) }}
                        className="text-[12px] px-3 py-1.5 rounded-lg bg-[#1d1d1f] text-white font-semibold hover:bg-black">Выдать доступ</button>
                    )}
                  </div>
                </div>
                {grantId === r.id && err && <p className="text-[11px] text-red-500 mt-1.5">{err}</p>}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-4 py-8 text-center text-[13px] text-[#9a9a95]">Ничего не найдено</div>}
          </div>
        )}
      </div>
    </div>
  )
}
