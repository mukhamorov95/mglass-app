'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatPhone, phoneKey } from '@/lib/b2c/phoneKey'

// Доска сделок — тот же список /deals, но по этажам пути денег: просчёт → КП →
// договор → оплата → готово. Этаж приходит с сервера вычисленным по реальным
// артефактам (см. /api/deals/board), руками ничего не двигают. Карточка → /deal/[id].
// Замер — не этаж, а факт на карточке: он и КП в нашем деле не упорядочены.

type Measure = { status: string | null; scheduled_at: string | null }
type Card = {
  id: number; client_name: string; address: string; phone: string; amo_lead_id: string | null
  manager_name: string | null; stage: string; value: number; paid: number; remaining: number
  calcCount: number; hasKp: boolean; measure: Measure | null; hasContract: boolean
  hasDrawing: boolean; ageDays: number
}
type Stage = { key: string; label: string }
type Kpis = { inWork: number; awaitingPay: number; stalled: number; receivedThisMonth: number }

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

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await fetch('/api/deals/board')
        const j = await r.json().catch(() => ({}))
        if (!alive) return
        if (!r.ok) { setError(j.error || 'Не удалось загрузить'); return }
        setCards(j.cards ?? []); setStages(j.stages ?? []); setKpis(j.kpis ?? null); setSeeAll(!!j.seeAll)
      } catch { if (alive) setError('Сеть недоступна') } finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

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

  const byStage = useMemo(() => {
    const m = new Map<string, Card[]>()
    for (const st of stages) m.set(st.key, [])
    for (const c of filtered) { const arr = m.get(c.stage); if (arr) arr.push(c) }
    return m
  }, [filtered, stages])

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="text-[24px] font-bold text-[#111110]">Сделки</h1>
          <p className="text-[13px] text-[#9a9a95] mt-0.5 max-w-[62ch]">
            Каждая карточка идёт по этажам пути денег: просчёт → КП → договор → оплата. Этаж вычисляется по тому, что в сделке реально появилось — руками ничего не двигают.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Поиск: телефон, адрес, клиент"
            className="border border-[#e4e4e0] rounded-xl px-3 py-2 text-[13px] w-64 outline-none focus:border-[#111110] transition-colors" />
          <div className="flex bg-white border border-[#e4e4e0] rounded-xl p-0.5">
            <Link href="/deals" className="text-[12.5px] font-medium px-3 py-1.5 rounded-[10px] text-[#4b4b47] hover:bg-[#f5f5f3] transition-colors">Список</Link>
            <span className="text-[12.5px] font-medium px-3 py-1.5 rounded-[10px] bg-[#111110] text-white">Доска</span>
          </div>
        </div>
      </div>

      {loading ? (
        <p className="text-[13px] text-[#9a9a95]">Загрузка…</p>
      ) : error ? (
        <p className="text-[13px] text-red-600">{error}</p>
      ) : (
        <>
          {kpis && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
              <Kpi label="В работе" value={`${kpis.inWork}`} unit="сделок" />
              <Kpi label="Ждут оплаты" value={fmt(kpis.awaitingPay)} mono />
              <Kpi label="Зависли > 7 дней" value={`${kpis.stalled}`} flag={kpis.stalled > 0} />
              <Kpi label="Поступило за месяц" value={fmt(kpis.receivedThisMonth)} mono />
            </div>
          )}

          <div className="flex gap-3.5 overflow-x-auto pb-3">
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
                  {list.map(c => <DealCard key={c.id} c={c} />)}
                  {list.length === 0 && <p className="text-[11px] text-[#c4c4be] px-1">—</p>}
                </div>
              )
            })}
          </div>

          <p className="text-[12px] text-[#9a9a95] mt-4 leading-relaxed max-w-[80ch]">
            <b className="text-[#4b4b47] font-semibold">Этаж = реальный артефакт.</b> Есть оплата → «Оплата», подписан договор → «Договор», отправлено КП → «КП отправлено». Замер — не этаж, а метка на карточке: янтарь — назначен, зелёный — проведён. «Без движения» считается по последнему событию в сделке: деньгам, КП, договору, замеру, чертежу. Ничего не перетаскивают руками — доска не врёт.
            {!seeAll && <span> Показаны ваши сделки.</span>}
          </p>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, unit, mono, flag }: { label: string; value: string; unit?: string; mono?: boolean; flag?: boolean }) {
  return (
    <div className="bg-white border border-[#e4e4e0] rounded-2xl px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-[#9a9a95] font-semibold">{label}</div>
      <div className={`text-[22px] font-semibold mt-1 leading-none ${flag ? 'text-red-600' : 'text-[#111110]'} ${mono ? 'tabular-nums' : ''}`}>
        {value}{unit && <span className="text-[13px] text-[#9a9a95] font-medium"> {unit}</span>}
      </div>
    </div>
  )
}

function ageClass(days: number) {
  if (days > 7) return 'text-red-600'
  if (days > 3) return 'text-amber-600'
  return 'text-[#9a9a95]'
}

function DealCard({ c }: { c: Card }) {
  const showPay = c.stage === 'pay' || c.stage === 'done'
  const pct = c.value > 0 ? Math.min(100, Math.round((c.paid / c.value) * 100)) : 0
  const full = c.stage === 'done'
  const amoHref = c.amo_lead_id ? `https://mglass.amocrm.ru/leads/detail/${c.amo_lead_id}` : null
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

      <div className="flex flex-wrap gap-1.5 mt-2">
        {c.calcCount > 0 && <Chip>⚡ {c.calcCount > 1 ? `Расчёт ×${c.calcCount}` : 'Расчёт'}</Chip>}
        {c.hasKp && <Chip tone="info">📄 КП</Chip>}
        {c.measure && <Chip tone={measureTone(c.measure)}>📐 {measureLabel(c.measure)}</Chip>}
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

      <div className="flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-[#f0f0ec]">
        <span className="text-[11.5px] text-[#9a9a95]">{c.phone ? formatPhone(c.phone) : '—'}</span>
        <span className="flex items-center gap-2">
          {amoHref && (
            <a href={amoHref} target="_blank" rel="noopener noreferrer" title="Открыть сделку в АМО"
              className="pointer-events-auto text-[11px] font-semibold text-[#4b4b47] px-1.5 py-0.5 rounded-md border border-[#e4e4e0] hover:border-[#111110] hover:text-[#111110] transition-colors">
              АМО ↗
            </a>
          )}
          <span className={`text-[11px] font-semibold ${ageClass(c.ageDays)}`}>
            {c.ageDays === 0 ? 'сегодня' : `без движения ${c.ageDays} д`}
          </span>
        </span>
      </div>
      </div>
    </div>
  )
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
