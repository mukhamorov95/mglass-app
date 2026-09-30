'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { leadIdFrom, type AmoLeadCard } from '@/lib/amoLead'

// Расчёт и КП в один клик из сделки AmoCRM (решение владельца 30.09, docs/MANAGER_UX_ROUTE.md):
// розница живёт в AmoCRM, приложение считает. Клиент подставляется из сделки, расчёт и КП
// ложатся с её номером и видны здесь же, в строке сделки.

type LeadRow = {
  id: number; name: string; price: number | null; stageName: string | null; updatedAt: string; url: string
  calcs: number; kps: number; lastKpId: number | null
}
type Found = { lead: AmoLeadCard; calcs: { id: number }[]; kps: { id: number }[] }

const rub = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`
const day = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short' })
const SHOWN = 10

function CalcButtons({ id }: { id: number }) {
  return (
    <div className="flex gap-1.5 shrink-0">
      <Link href={`/calculator/build?amo=${id}`}
        className="px-2.5 py-1.5 rounded-lg bg-[#111110] text-white text-[12px] font-medium hover:bg-[#2a2a28] transition-colors">
        Расчёт
      </Link>
      <Link href={`/calculator/quick?amo=${id}`}
        className="px-2.5 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] text-[#111110] hover:bg-[#f8f8f7] transition-colors">
        Быстрый
      </Link>
    </div>
  )
}

function WorkChips({ calcs, kps, lastKpId }: { calcs: number; kps: number; lastKpId: number | null }) {
  if (!calcs && !kps) return null
  return (
    <span className="inline-flex gap-1.5 ml-2 align-middle">
      {calcs > 0 && (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#eef3ee] text-[#3f6b48]">
          расчёт{calcs > 1 ? ` ×${calcs}` : ''} ✓
        </span>
      )}
      {kps > 0 && (lastKpId
        ? <a href={`/kp/${lastKpId}/print`} target="_blank" rel="noreferrer"
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#eef3ee] text-[#3f6b48] hover:underline">
            КП{kps > 1 ? ` ×${kps}` : ''} ✓
          </a>
        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#eef3ee] text-[#3f6b48]">КП ✓</span>)}
    </span>
  )
}

export default function AmoLeadsWork() {
  const [leads, setLeads] = useState<LeadRow[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [workError, setWorkError] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const [query, setQuery] = useState('')
  const [finding, setFinding] = useState(false)
  const [found, setFound] = useState<Found | null>(null)
  const [findError, setFindError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/amo/my-leads')
        const j = await r.json().catch(() => ({})) as { leads?: LeadRow[]; error?: string; workError?: string | null }
        if (j.error === 'amo_not_configured') { setListError('Ваш аккаунт не привязан к AmoCRM — список сделок не построить. Номер сделки можно вставить в поле выше.'); return }
        if (!r.ok || !j.leads) { setListError(j.error ?? `Ошибка ${r.status}`); return }
        setLeads(j.leads)
        setWorkError(j.workError ?? null)
      } catch {
        setListError('Сервер не ответил — проверьте связь и обновите страницу')
      }
    })()
  }, [])

  async function find(e: FormEvent) {
    e.preventDefault()
    if (!query.trim()) return
    setFound(null)
    // Ссылку разбираем здесь: целый адрес в пути запроса ломается на прокси.
    const id = leadIdFrom(query)
    if (!id) { setFindError('Не вижу номера сделки — вставьте номер или ссылку на карточку в AmoCRM'); return }
    setFinding(true); setFindError(null)
    try {
      const r = await fetch(`/api/amo/lead/${id}`)
      const j = await r.json().catch(() => ({})) as Partial<Found> & { error?: string }
      if (!r.ok || !j.lead) setFindError(j.error ?? `Ошибка ${r.status}`)
      else setFound({ lead: j.lead, calcs: j.calcs ?? [], kps: j.kps ?? [] })
    } catch {
      setFindError('Сервер не ответил — проверьте связь')
    } finally { setFinding(false) }
  }

  const visible = leads ? (showAll ? leads : leads.slice(0, SHOWN)) : []

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl mb-5 overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-[#f0f0ec]">
        <p className="text-[13px] font-semibold text-[#111110]">Расчёт и КП по сделке AmoCRM</p>
        <p className="text-[12px] text-[#9a9a95] mt-0.5">Клиент подставится из сделки, расчёт и КП лягут в неё — отметка появится в строке сделки.</p>
        <form onSubmit={find} className="mt-3 flex gap-2">
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Номер сделки или ссылка из AmoCRM" inputMode="url"
            className="flex-1 min-w-0 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
          <button type="submit" disabled={finding || !query.trim()}
            className="px-3 py-2 rounded-lg border border-[#e4e4e0] text-[13px] text-[#111110] hover:bg-[#f8f8f7] disabled:opacity-50 transition-colors">
            {finding ? 'Ищу…' : 'Найти'}
          </button>
        </form>
        {findError && <p className="mt-2 text-[12px] text-red-600">{findError}</p>}
        {found && (
          <div className="mt-3 rounded-lg bg-[#f8f8f7] border border-[#ecece8] px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-[#111110] truncate">
                <a href={found.lead.url} target="_blank" rel="noreferrer" className="hover:underline">№{found.lead.id} · {found.lead.name}</a>
                <WorkChips calcs={found.calcs.length} kps={found.kps.length} lastKpId={found.kps[0]?.id ?? null} />
              </p>
              <p className="text-[11px] text-[#9a9a95] mt-0.5">
                {[found.lead.stageName, found.lead.closed && 'сделка закрыта', found.lead.contactName, found.lead.phone].filter(Boolean).join(' · ') || 'Контакт в сделке не указан'}
              </p>
            </div>
            <CalcButtons id={found.lead.id} />
          </div>
        )}
      </div>

      <div className="px-5 py-2.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-[#8a8a85]">Мои открытые сделки · свежие сверху</span>
        {leads && <span className="text-[11px] text-[#9a9a95]">{leads.length}</span>}
      </div>
      {listError && <p className="px-5 pb-4 text-[12px] text-red-600">{listError}</p>}
      {!listError && !leads && <p className="px-5 pb-4 text-[12px] text-[#9a9a95]">Загружаю сделки из AmoCRM…</p>}
      {workError && <p className="px-5 pb-2 text-[12px] text-amber-700">Не удалось проверить, есть ли уже расчёты и КП: {workError}</p>}
      {leads && leads.length === 0 && <p className="px-5 pb-4 text-[12px] text-[#9a9a95]">Открытых сделок нет.</p>}
      {visible.length > 0 && (
        <div className="divide-y divide-[#f4f4f1] border-t border-[#f0f0ec]">
          {visible.map(l => (
            <div key={l.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[#111110] truncate">
                  <a href={l.url} target="_blank" rel="noreferrer" className="hover:underline">{l.name}</a>
                  <WorkChips calcs={l.calcs} kps={l.kps} lastKpId={l.lastKpId} />
                </p>
                <p className="text-[11px] text-[#9a9a95] mt-0.5">
                  {[l.stageName, l.price ? rub(l.price) : null, `обновлена ${day(l.updatedAt)}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <CalcButtons id={l.id} />
            </div>
          ))}
        </div>
      )}
      {leads && leads.length > SHOWN && (
        <button onClick={() => setShowAll(v => !v)}
          className="w-full px-5 py-2.5 border-t border-[#f0f0ec] text-[12px] text-[#6b6b66] hover:bg-[#fafaf9] transition-colors">
          {showAll ? 'Свернуть' : `Показать все ${leads.length}`}
        </button>
      )}
    </div>
  )
}
