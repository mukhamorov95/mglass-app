'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatPhone, phoneKey, telHref, waHref } from '@/lib/b2c/phoneKey'

// Доска сделок — тот же список /deals, но по этажам пути денег: просчёт → КП →
// договор → оплата → готово. Этаж приходит с сервера вычисленным по реальным
// артефактам (см. /api/deals/board), руками ничего не двигают. Карточка → /deal/[id].
// Замер — не этаж, а факт на карточке: он и КП в нашем деле не упорядочены.

type Measure = { status: string | null; scheduled_at: string | null }
type Card = {
  id: number; client_name: string; address: string; phone: string; amo_lead_id: string | null
  manager_name: string | null; stage: string; value: number; paid: number; remaining: number
  calcCount: number; hasKp: boolean; measure: Measure | null; hasContract: boolean
  hasDrawing: boolean; ageDays: number; source: string | null; archived: boolean
  lost: boolean; lostReason: string | null; nextContactAt: string | null
}
type Stage = { key: string; label: string }
type AmoLead = { id: number; name: string; stage: string; manager: string; createdAt: string }
// Каналы как в АМО. Список живёт здесь: меняется чаще схемы, в базе — просто текст.
export const SOURCES: { id: string; label: string }[] = [
  { id: 'avito',     label: 'Авито' },
  { id: 'site',      label: 'Заявка с сайта' },
  { id: 'call',      label: 'Звонок' },
  { id: 'recommend', label: 'Рекомендация' },
  { id: 'partner',   label: 'Партнёр / дизайнер' },
  { id: 'repeat',    label: 'Повторный клиент' },
  { id: 'other',     label: 'Другое' },
]
export const sourceLabel = (id?: string | null) => SOURCES.find(s => s.id === id)?.label ?? (id || '')
type Kpis = { inWork: number; awaitingPay: number; stalled: number; overdue: number; receivedThisMonth: number }

// Цвет этажа: точка + верхняя граница колонки. Семантика (не акцент): синий=КП,
// янтарь=договор, фирменный красный=оплата, зелёный=готово.
const STAGE_HEX: Record<string, string> = {
  new: '#9a9a95', quote: '#9a988f', kp: '#2f6fb0',
  contract: '#b7791f', pay: '#E1442E', done: '#2f8f5b',
}

const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₽`

export default function DealBoardPage() {
  const [cards, setCards] = useState<Card[]>([])
  const [stages, setStages] = useState<Stage[]>([])
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [seeAll, setSeeAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [focus, setFocus] = useState<'all' | 'inWork' | 'awaiting' | 'stalled' | 'overdue'>('all')
  const [adding, setAdding] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [showLost, setShowLost] = useState(false)
  const [manager, setManager] = useState('')     // фильтр владельца: чьи сделки смотрим
  const [form, setForm] = useState({ client_name: '', phone: '', address: '', source: '' })
  const [creating, setCreating] = useState(false)
  // Второй способ завести карточку — забрать заявку из АМО. Из CRM только читаем.
  const [addTab, setAddTab] = useState<'manual' | 'amo'>('manual')
  const [amo, setAmo] = useState<{ leads: AmoLead[]; needsAmoLink?: boolean } | null>(null)
  const [amoState, setAmoState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [amoErr, setAmoErr] = useState('')
  const [amoLink, setAmoLink] = useState('')

  async function loadAmo() {
    setAmoState('loading'); setAmoErr('')
    try {
      const r = await fetch('/api/deals/amo-inbox')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { setAmoErr(j.error || 'Не удалось получить заявки'); setAmoState('error'); return }
      setAmo({ leads: j.leads ?? [], needsAmoLink: !!j.needsAmoLink }); setAmoState('idle')
    } catch { setAmoErr('Сеть недоступна'); setAmoState('error') }
  }

  async function importAmo(lead: string | number) {
    setCreating(true)
    try {
      const r = await fetch('/api/deals/amo-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.id) window.location.assign(`/deal/${j.id}`)
      else setAmoErr(j.error || 'Не удалось импортировать')
    } finally { setCreating(false) }
  }

  async function createDeal() {
    if (!form.client_name.trim() && !form.phone.trim()) return
    setCreating(true)
    try {
      const r = await fetch('/api/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.id) window.location.assign(`/deal/${j.id}`)
    } finally { setCreating(false) }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch(`/api/deals/board${showArchive ? '?archived=1' : showLost ? '?lost=1' : ''}`)
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setError(j.error || 'Не удалось загрузить'); return }
        setCards(j.cards ?? []); setStages(j.stages ?? []); setKpis(j.kpis ?? null); setSeeAll(!!j.seeAll)
      } catch { if (alive) setError('Сеть недоступна') } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [showArchive, showLost])

  // Телефон ищем по тем же правилам, что и список: сравниваем цифры, а не строку,
  // иначе «8926…» не находит сделку, записанную как «+7 926…».
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return cards
    const digits = s.replace(/\D/g, '')
    const qKey = digits.length >= 10 ? (phoneKey(digits) ?? digits) : digits
    return cards.filter(c => {
      if (c.address.toLowerCase().includes(s) || c.client_name.toLowerCase().includes(s)) return true
      if (digits.length < 3) return false
      const cKey = phoneKey(c.phone) ?? c.phone.replace(/\D/g, '')
      return cKey.includes(qKey)
    })
  }, [cards, q])

  // Показатель сверху — это ещё и фильтр доски: нажал «Зависли» — видишь только их.
  // Иначе цифра «зависли 6» есть, а найти эти шесть на доске нечем.
  const managers = useMemo(
    () => [...new Set(cards.map(c => c.manager_name).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'ru')),
    [cards])

  const focused = useMemo(() => {
    const base = manager ? filtered.filter(c => c.manager_name === manager) : filtered
    if (focus === 'inWork') return base.filter(c => c.stage !== 'done')
    if (focus === 'awaiting') return base.filter(c => c.stage === 'contract' || c.stage === 'pay')
    if (focus === 'stalled') return base.filter(c => c.stage !== 'done' && c.ageDays > 7)
    if (focus === 'overdue') return base.filter(c => c.stage !== 'done' && !!c.nextContactAt && c.nextContactAt <= todayStr())
    return base
  }, [filtered, focus, manager])

  const byStage = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const st of stages) m.set(st.key, [])
    for (const c of focused) { const arr = m.get(c.stage); if (arr) arr.push(c) }
    return m
  }, [focused, stages])

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">{showArchive ? 'Архив сделок' : showLost ? 'Отказы' : 'Сделки'}</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5 max-w-[62ch]">
            Каждая карточка идёт по этажам пути денег: просчёт → КП → договор → оплата. Этаж вычисляется по тому, что в сделке реально появилось — руками ничего не двигают.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Поиск: телефон, адрес, клиент"
            className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] w-full sm:w-64 outline-none focus:border-[#111110] transition-colors" />
          {/* Владельцу видны все сделки: без фильтра по менеджеру доска на команде
              превращается в кашу. Менеджеру фильтр не нужен — у него только свои. */}
          {seeAll && managers.length > 1 && (
            <select value={manager} onChange={e => setManager(e.target.value)}
              className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] bg-white outline-none focus:border-[#111110]">
              <option value="">Все менеджеры</option>
              {managers.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {/* Единственный способ завести карточку руками — клиент позвонил, расчёта
              ещё нет. Всё остальное приходит на доску само, с первым расчётом. */}
          <button onClick={() => { setShowLost(v => !v); setShowArchive(false); setLoading(true); setFocus('all') }}
            className={`text-[12.5px] font-medium px-3.5 py-2 rounded-xl border transition-colors ${showLost ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#4b4b47] hover:border-[#111110]'}`}>
            {showLost ? 'В работе' : 'Отказы'}
          </button>
          <button onClick={() => { setShowArchive(v => !v); setShowLost(false); setLoading(true); setFocus('all') }}
            className={`text-[12.5px] font-medium px-3.5 py-2 rounded-xl border transition-colors ${showArchive ? 'border-[#111110] bg-[#111110] text-white' : 'border-[#e4e4e0] bg-white text-[#4b4b47] hover:border-[#111110]'}`}>
            {showArchive ? 'Активные' : 'Архив'}
          </button>
          {!showArchive && !showLost && (
            <button onClick={() => setAdding(v => !v)}
              className="text-[12.5px] font-semibold px-3.5 py-2 rounded-xl bg-[#111110] text-white hover:bg-[#2a2a28] transition-colors">
              {adding ? 'Отмена' : '+ Сделка'}
            </button>
          )}
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-[#111110] rounded-2xl p-4 mb-4">
          <div className="flex items-center gap-1 mb-3">
            {([['manual', 'Ввести вручную'], ['amo', 'Взять из AmoCRM']] as const).map(([k, label]) => (
              <button key={k} onClick={() => { setAddTab(k); if (k === 'amo' && !amo) loadAmo() }}
                className={`text-[12.5px] font-medium px-3 py-1.5 rounded-lg transition-colors ${addTab === k ? 'bg-[#111110] text-white' : 'text-[#4b4b47] hover:bg-[#f5f5f3]'}`}>
                {label}
              </button>
            ))}
          </div>

          {addTab === 'amo' ? (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <input value={amoLink} onChange={e => setAmoLink(e.target.value)}
                  placeholder="Ссылка на заявку в АМО или её номер"
                  className="flex-1 border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                <button onClick={() => importAmo(amoLink)} disabled={creating || !amoLink.trim()}
                  className="text-[13px] font-semibold px-4 py-2 rounded-xl bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
                  Забрать
                </button>
              </div>
              {amoState === 'loading' && <p className="text-[12px] text-[#9a9a95]">Смотрю заявки в АМО…</p>}
              {amoErr && <p className="text-[12px] text-red-600 mb-2">{amoErr}</p>}
              {amo?.needsAmoLink && (
                <p className="text-[12px] text-amber-700">Ваш профиль не связан с пользователем AmoCRM — попросите админа проставить amo_user_id, иначе чужие заявки показывать нельзя.</p>
              )}
              {amo && !amo.needsAmoLink && (
                amo.leads.length === 0 ? (
                  <p className="text-[12px] text-[#9a9a95]">Новых заявок с сентября нет — всё уже заведено.</p>
                ) : (
                  <div className="max-h-[320px] overflow-y-auto divide-y divide-[#f0f0ec] border border-[#f0f0ec] rounded-xl">
                    {amo.leads.map(l => (
                      <div key={l.id} className="px-3 py-2 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] text-[#111110] truncate">{l.name || `Заявка #${l.id}`}</p>
                          <p className="text-[11px] text-[#9a9a95] truncate">{l.stage}{l.manager ? ` · ${l.manager}` : ''} · {new Date(l.createdAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}</p>
                        </div>
                        <button onClick={() => importAmo(l.id)} disabled={creating}
                          className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-[#111110] text-[#111110] hover:bg-[#111110] hover:text-white disabled:opacity-40 whitespace-nowrap">
                          Забрать
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
              <p className="text-[11px] text-[#9a9a95] mt-2">Показаны заявки с 1 сентября, которых ещё нет в системе. В АМО ничего не меняется — только читаем.</p>
            </div>
          ) : (
          <>
          <p className="text-[12px] font-semibold text-[#111110] mb-2">Новая сделка</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input autoFocus value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))}
              placeholder="Клиент" className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              placeholder="Телефон" inputMode="tel" className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Адрес объекта" className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
            <select value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
              className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] outline-none focus:border-[#111110] bg-white">
              <option value="">Источник не указан</option>
              {SOURCES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-3 mt-2.5">
            <button onClick={createDeal} disabled={creating || (!form.client_name.trim() && !form.phone.trim())}
              className="text-[13px] font-semibold px-4 py-2 rounded-xl bg-[#111110] text-white hover:bg-[#2a2a28] disabled:opacity-40">
              {creating ? 'Создаю…' : 'Завести и открыть'}
            </button>
            <span className="text-[11.5px] text-[#9a9a95]">Попадёт в «Новая». Дальше — расчёт.</span>
          </div>
          </>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : (
        <>
          {kpis && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-2">
                <Kpi label="В работе" value={`${kpis.inWork}`} unit="сделок"
                  active={focus === 'inWork'} onClick={() => setFocus(f => f === 'inWork' ? 'all' : 'inWork')} />
                <Kpi label="Ждут оплаты" value={fmt(kpis.awaitingPay)} mono
                  active={focus === 'awaiting'} onClick={() => setFocus(f => f === 'awaiting' ? 'all' : 'awaiting')} />
                <Kpi label="Просрочен контакт" value={`${kpis.overdue}`} flag={kpis.overdue > 0}
                  active={focus === 'overdue'} onClick={() => setFocus(f => f === 'overdue' ? 'all' : 'overdue')} />
                <Kpi label="Зависли > 7 дней" value={`${kpis.stalled}`} flag={kpis.stalled > 0}
                  active={focus === 'stalled'} onClick={() => setFocus(f => f === 'stalled' ? 'all' : 'stalled')} />
                <Kpi label="Поступило за месяц" value={fmt(kpis.receivedThisMonth)} mono />
              </div>
              <p className="text-[11.5px] text-[#9a9a95] mb-4">
                {focus === 'all'
                  ? 'Нажмите на показатель — доска покажет только эти сделки.'
                  : <>Показаны только «{FOCUS_LABEL[focus]}» — {focused.length}. <button onClick={() => setFocus('all')} className="underline hover:text-[#111110]">показать все</button></>}
              </p>
            </>
          )}

          {/* Колонки — с ноутбука. На телефоне шесть колонок по горизонтали
              означают, что «Оплата» и «Готово» физически за краем экрана,
              поэтому там тот же набор идёт списком по этажам. */}
          <div className="hidden lg:flex gap-3.5 overflow-x-auto pb-3">
            {stages.map(st => {
              const list = byStage.get(st.key) ?? []
              const sum = list.reduce((s, c) => s + c.value, 0)
              const hex = STAGE_HEX[st.key] ?? '#9a9a95'
              return (
                <div key={st.key} className="flex-none w-[268px] flex flex-col gap-2.5">
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-2 border-b-2" style={{ borderColor: hex }}>
                    <span className="text-[13px] font-bold text-[#111110] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: hex }} />{st.label}
                    </span>
                    <span className="text-right leading-tight">
                      <span className="block text-[12px] text-[#9a9a95] font-semibold">{list.length}</span>
                      {sum > 0 && <span className="block text-[11px] text-[#4b4b47] font-semibold tabular-nums">{fmt(sum)}</span>}
                    </span>
                  </div>
                  {list.map(c => <DealCard key={c.id} c={c} showManager={seeAll} />)}
                  {list.length === 0 && <p className="text-[11px] text-[#c4c4be] px-1">—</p>}
                </div>
              )
            })}
          </div>

          <div className="lg:hidden space-y-4">
            {stages.map(st => {
              const list = byStage.get(st.key) ?? []
              if (list.length === 0) return null
              const sum = list.reduce((s2, c) => s2 + c.value, 0)
              const hex = STAGE_HEX[st.key] ?? '#9a9a95'
              return (
                <div key={st.key}>
                  <div className="flex items-baseline justify-between gap-2 px-1 pb-2 border-b-2" style={{ borderColor: hex }}>
                    <span className="text-[13px] font-bold text-[#111110] flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: hex }} />{st.label}
                    </span>
                    <span className="text-[12px] text-[#9a9a95] font-semibold">
                      {list.length}{sum > 0 ? ` · ${fmt(sum)}` : ''}
                    </span>
                  </div>
                  <div className="space-y-2.5 mt-2.5">
                    {list.map(c => <DealCard key={c.id} c={c} showManager={seeAll} />)}
                  </div>
                </div>
              )
            })}
            {focused.length === 0 && <p className="text-[13px] text-[#9a9a95]">Ничего не найдено.</p>}
          </div>

          {/* Инструкция нужна, но на телефоне занимала пол-экрана — свернул. */}
          <details className="mt-4 max-w-[80ch]">
            <summary className="text-[12px] text-[#6b6b66] cursor-pointer select-none">Как это работает</summary>
          <div className="text-[12px] text-[#9a9a95] mt-2 leading-relaxed space-y-1.5">
            <p>
              <b className="text-[#4b4b47] font-semibold">Откуда берутся карточки.</b> Сделка заводится сама на первом сохранённом расчёте, где есть телефон или адрес, — такая карточка появляется сразу в «Просчёт». В «Новая» попадают только заведённые руками кнопкой «+ Сделка»: клиент позвонил, расчёта ещё нет. Пустых карточек система не плодит.
            </p>
            <p>
              <b className="text-[#4b4b47] font-semibold">Как работать.</b> Столбец — где сделка сейчас. Чёрная кнопка на карточке — следующий шаг, ведёт сразу в нужное место сделки. Клик по самой карточке открывает её целиком. Показатель сверху — фильтр: начните день с «Просрочен контакт».
            </p>
            <p>
              <b className="text-[#4b4b47] font-semibold">Столбец не перетаскивают.</b> Сделка переходит сама, когда в ней появляется артефакт: отправлено КП → «КП отправлено», подписан договор → «Договор», пришли деньги → «Оплата», оплачено полностью → «Готово». Замер — не столбец, а метка: янтарь — назначен, зелёный — проведён. «Без движения» считается по последнему событию: деньгам, КП, договору, замеру, чертежу. Если в сделке назначена дата следующего контакта, карточка показывает её, а не возраст: обещание точнее тишины. Клиент отказался — кнопка «Отказ» в сделке с причиной; такие уходят с доски в отдельный вид «Отказы» и не считаются ни «в работе», ни «зависшими».
              {!seeAll && <span> Показаны ваши сделки.</span>}
            </p>
          </div>
          </details>
        </>
      )}
    </div>
  )
}

const FOCUS_LABEL: Record<string, string> = {
  inWork: 'В работе', awaiting: 'Ждут оплаты', stalled: 'Зависли > 7 дней', overdue: 'Просрочен контакт',
}

function Kpi({ label, value, unit, mono, flag, active, onClick }: {
  label: string; value: string; unit?: string; mono?: boolean; flag?: boolean
  active?: boolean; onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag onClick={onClick}
      className={`text-left bg-white border rounded-2xl px-4 py-3 transition-colors ${active ? 'border-[#111110] bg-[#fbfbf9]' : 'border-[#e4e4e0]'} ${onClick ? 'hover:border-[#111110]' : ''}`}>
      <div className="text-[11px] uppercase tracking-wide text-[#9a9a95] font-semibold">{label}</div>
      <div className={`text-[22px] font-semibold mt-1 leading-none ${flag ? 'text-red-600' : 'text-[#111110]'} ${mono ? 'tabular-nums' : ''}`}>
        {value}{unit && <span className="text-[13px] text-[#9a9a95] font-medium"> {unit}</span>}
      </div>
    </Tag>
  )
}

const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' })

function ageClass(days: number) {
  if (days > 7) return 'text-red-600'
  if (days > 3) return 'text-amber-600'
  return 'text-[#9a9a95]'
}

function DealCard({ c, showManager }: { c: Card; showManager?: boolean }) {
  const showPay = c.stage === 'pay' || c.stage === 'done'
  const pct = c.value > 0 ? Math.min(100, Math.round((c.paid / c.value) * 100)) : 0
  const full = c.stage === 'done'
  const amoHref = c.amo_lead_id ? `https://mglass.amocrm.ru/leads/detail/${c.amo_lead_id}` : null
  const next = nextStep(c)
  // Ссылка на карточку тянется на всю плитку слоем под содержимым: так внутри
  // помещается отдельная ссылка в АМО (вложенная <a> в <a> недопустима).
  return (
    <div className="relative bg-white border border-[#e4e4e0] rounded-xl px-3.5 py-3 hover:border-[#111110] hover:-translate-y-px transition-all">
      <Link href={`/deal/${c.id}`} aria-label={`Сделка ${c.client_name || c.id}`}
        className="absolute inset-0 rounded-xl z-0" />
      <div className="relative z-10 pointer-events-none">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-semibold text-[#111110] truncate">{c.client_name || 'Без имени'}</span>
        {c.value > 0 && <span className="text-[13px] font-semibold text-[#111110] tabular-nums whitespace-nowrap">{fmt(c.value)}</span>}
      </div>
      <div className="text-[12px] text-[#4b4b47] mt-0.5 truncate">{c.address || <span className="text-[#9a9a95]">адрес не указан</span>}</div>
      {showManager && c.manager_name && <div className="text-[11px] text-[#9a9a95] truncate">{c.manager_name}</div>}

      <div className="flex flex-wrap gap-1.5 mt-2">
        {c.calcCount > 0 && <Chip>⚡ {c.calcCount > 1 ? `Расчёт ×${c.calcCount}` : 'Расчёт'}</Chip>}
        {c.hasKp && <Chip tone="info">📄 КП</Chip>}
        {c.measure && <Chip tone={measureTone(c.measure)}>📐 {measureLabel(c.measure)}</Chip>}
        {c.source && <Chip>{sourceLabel(c.source)}</Chip>}
        {c.lostReason && <Chip tone="warn">✕ {c.lostReason}</Chip>}
        {c.hasDrawing && <Chip tone="good">📎 чертёж</Chip>}
        {c.hasContract && <Chip tone="good">📝 договор</Chip>}
      </div>

      {showPay && c.value > 0 && (
        <div className="mt-2.5">
          <div className="flex justify-between text-[11px] text-[#9a9a95] mb-1">
            <span>{full ? 'Оплачено' : 'Поступило'}</span>
            <span className="text-[#111110] font-semibold tabular-nums">{fmt(c.paid)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#eceae3] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: full ? '#2f8f5b' : '#E1442E' }} />
          </div>
          {!full && c.remaining > 0 && (
            <div className="flex justify-between text-[11px] text-[#9a9a95] mt-1">
              <span>Остаток</span><span className="tabular-nums">{fmt(c.remaining)}</span>
            </div>
          )}
        </div>
      )}

      {/* Следующий шаг — главное, чего не хватало: доска показывала состояние,
          но не говорила, что делать. Ведёт сразу на нужную вкладку карточки. */}
      {next && (
        <Link href={next.href}
          className="pointer-events-auto relative z-20 mt-2.5 flex items-center justify-center gap-1 rounded-lg border border-[#111110] px-2 py-1.5 text-[11.5px] font-semibold text-[#111110] hover:bg-[#111110] hover:text-white transition-colors">
          {next.label}
        </Link>
      )}

      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-[#f0f0ec]">
        {/* Позвонить и написать прямо с доски — на телефоне это главный жест. */}
        {c.phone && telHref(c.phone) ? (
          <span className="flex items-center gap-1.5 pointer-events-auto relative z-20">
            <a href={telHref(c.phone)!} className="text-[11.5px] text-[#4b4b47] hover:text-[#111110] hover:underline">{formatPhone(c.phone)}</a>
            <a href={waHref(c.phone)!} target="_blank" rel="noopener noreferrer" title="Написать в WhatsApp"
              className="text-[11px] leading-none px-1.5 py-0.5 rounded-md border border-[#e4e4e0] text-[#4b4b47] hover:border-[#2f8f5b] hover:text-[#2f8f5b] transition-colors">WA</a>
          </span>
        ) : <span className="text-[11.5px] text-[#9a9a95]">—</span>}
        <span className="flex items-center gap-2">
          {amoHref && (
            <a href={amoHref} target="_blank" rel="noopener noreferrer" title="Открыть сделку в АМО"
              className="pointer-events-auto text-[11px] font-semibold text-[#4b4b47] px-1.5 py-0.5 rounded-md border border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110] transition-colors">
              АМО ↗
            </a>
          )}
          {/* Обещание перезвонить важнее «давно не трогали»: если дата назначена,
              показываем её, а не возраст. */}
          {c.nextContactAt ? (
            <span className={`text-[11px] font-semibold ${c.nextContactAt <= todayStr() ? 'text-red-600' : 'text-[#4b4b47]'}`}>
              {c.nextContactAt <= todayStr() ? '📞 просрочен' : `📞 ${new Date(c.nextContactAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}`}
            </span>
          ) : (
            <span className={`text-[11px] font-semibold ${ageClass(c.ageDays)}`}>
              {c.ageDays === 0 ? 'сегодня' : `без движения ${c.ageDays} д`}
            </span>
          )}
        </span>
      </div>
      </div>
    </div>
  )
}

// Что делать со сделкой дальше. Один шаг, не список: доска отвечает на вопрос
// «что сейчас», а не заменяет карточку. Ссылка ведёт на вкладку, где этот шаг делается.
function nextStep(c: Card): { label: string; href: string } | null {
  const d = `/deal/${c.id}`
  switch (c.stage) {
    case 'new':      return { label: 'Сделать расчёт', href: `/calculator/build?deal=${c.id}` }
    case 'quote':    return { label: 'Сделать КП', href: `${d}#docs` }
    case 'kp':       return c.measure ? { label: 'Договор', href: `${d}#docs` }
                                      : { label: 'Замер или договор', href: `${d}#docs` }
    case 'contract': return { label: 'Отметить оплату', href: `${d}#money` }
    case 'pay':      return { label: c.remaining > 0 ? `Внести остаток ${fmt(c.remaining)}` : 'Деньги', href: `${d}#money` }
    default:         return null
  }
}

// Замер: заявка отправлена ≠ замер проведён. Зелёный только на «проведён»,
// назначенный — янтарь, просто заявка — нейтральный.
function measureTone(m: Measure): 'plain' | 'warn' | 'good' {
  if (m.status === 'done' || m.status === 'completed') return 'good'
  if (m.scheduled_at || m.status === 'scheduled') return 'warn'
  return 'plain'
}

function measureLabel(m: Measure) {
  if (m.status === 'done' || m.status === 'completed') return 'замер ✓'
  if (m.scheduled_at) {
    const d = new Date(m.scheduled_at)
    if (!Number.isNaN(d.getTime())) return `замер ${d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' })}`
  }
  return 'замер заявлен'
}

const CHIP_TONE: Record<string, string> = {
  plain: 'bg-[#faf9f6] text-[#4b4b47] border-[#eeece6]',
  info: 'bg-[#e6eef7] text-[#2f6fb0] border-transparent',
  warn: 'bg-[#f7efdd] text-[#b7791f] border-transparent',
  good: 'bg-[#e8f3ec] text-[#2f8f5b] border-transparent',
}
function Chip({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'info' | 'warn' | 'good' }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${CHIP_TONE[tone]}`}>{children}</span>
}
