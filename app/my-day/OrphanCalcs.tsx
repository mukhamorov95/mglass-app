'use client'

import { useEffect, useState } from 'react'

type Orphan = {
  id: number
  created_at: string
  product_type: string | null
  client_name: string | null
  client_phone: string | null
  final_price: number | string | null
  client_text: string | null
}

const RUB = (v: number | string | null) =>
  v == null ? '—' : `${Math.round(Number(v)).toLocaleString('ru-RU')} ₽`

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })

// Расчёты, не привязанные к сделке. Быстрый расчёт разрешает считать без клиента —
// и такой расчёт исчезал: в воронку не попадал, найти его было негде. Здесь он
// виден и закрывается в два поля: имя и телефон заводят сделку.
export function OrphanCalcs() {
  const [items, setItems] = useState<Orphan[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    let off = false
    fetch('/api/calculations/orphans')
      .then(r => r.json())
      .then(j => { if (!off) setItems(Array.isArray(j?.items) ? j.items : []) })
      .catch(() => { if (!off) setItems([]) })
    return () => { off = true }
  }, [])

  function open(o: Orphan) {
    setOpenId(o.id)
    setName(o.client_name ?? '')
    setPhone(o.client_phone ?? '')
    setAddress('')
    setMsg(null)
  }

  async function attach(calcId: number) {
    if (name.trim().length < 2 || phone.replace(/\D/g, '').length < 10) {
      setMsg('Нужно имя и телефон'); return
    }
    setBusy(true); setMsg(null)
    try {
      const r = await fetch('/api/deals/ensure', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calc_id: calcId, client_name: name.trim(), phone: phone.trim(), address: address.trim() }),
      }).then(x => x.json()).catch(() => null)

      if (r?.created) {
        setItems(prev => (prev ?? []).filter(i => i.id !== calcId))
        setOpenId(null)
      } else if (r?.ambiguous) {
        // Такой телефон уже есть в другой сделке — склеивать молча нельзя.
        setMsg('Такой телефон уже есть в сделке. Откройте «Сделки» и добавьте расчёт туда.')
      } else {
        setMsg(r?.error ?? 'Не получилось завести сделку')
      }
    } finally { setBusy(false) }
  }

  if (items == null || items.length === 0) return null

  return (
    <div className="rounded-xl border border-[#e4e4e0] bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e4e4e0]">
        <p className="text-[14px] font-semibold text-[#111110]">Расчёты без клиента · {items.length}</p>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">
          Посчитано, но ни в какую сделку не попало — впишите имя и телефон, иначе расчёт потеряется.
        </p>
      </div>
      <div className="divide-y divide-[#f0f0ec]">
        {items.map(o => (
          <div key={o.id} className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] text-[#111110] truncate">
                  {o.client_text || o.client_name || `Расчёт #${o.id}`}
                </p>
                <p className="text-[12px] text-[#9a9a95]">{day(o.created_at)} · {RUB(o.final_price)}</p>
              </div>
              <button onClick={() => (openId === o.id ? setOpenId(null) : open(o))}
                className="shrink-0 px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:bg-[#f5f5f3]">
                {openId === o.id ? 'Закрыть' : 'Привязать'}
              </button>
            </div>

            {openId === o.id && (
              <div className="mt-3 grid grid-cols-1 gap-2">
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Имя клиента"
                  className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                <div className="grid grid-cols-2 gap-2">
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Телефон" inputMode="tel"
                    className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                  <input value={address} onChange={e => setAddress(e.target.value)} placeholder="Адрес (необязательно)"
                    className="px-3 py-2 border border-[#e4e4e0] rounded-lg text-[13px] outline-none focus:border-[#111110]" />
                </div>
                <button onClick={() => attach(o.id)} disabled={busy}
                  className="px-4 py-2 rounded-lg bg-[#111110] text-white text-[13px] font-semibold disabled:opacity-40">
                  {busy ? 'Завожу…' : 'Завести сделку'}
                </button>
                {msg && <p className="text-[12px] text-[#c2410c]">{msg}</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
