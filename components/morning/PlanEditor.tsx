'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { confirmDialog } from '@/lib/dialog'
import { monthName, rub } from '@/lib/morning'

// Редактор планов на «Команде» (М6): владелец ставит каждому продавцу план месяца в
// поступлениях. «Есть несохранённое» выводится сравнением с сохранённым, а черновик
// живёт в localStorage до сохранения или явного «Отменить правки».

type Seller = { amoUserId: number; name: string }
type Plans = Record<string, Record<number, number | null>>   // месяц → amo-id → план

const draftKey = (month: string) => `mglass.plan-draft.v1.${month}`
const parse = (s: string): number | null => {
  const digits = s.replace(/[^\d]/g, '')
  return digits ? Number(digits) : null
}
const show = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('ru-RU'))

function readDraft(month: string): Record<number, string> | null {
  try {
    const raw = window.localStorage.getItem(draftKey(month))
    return raw ? (JSON.parse(raw) as Record<number, string>) : null
  } catch { return null }
}
function writeDraft(month: string, d: Record<number, string> | null) {
  try {
    if (d) window.localStorage.setItem(draftKey(month), JSON.stringify(d))
    else window.localStorage.removeItem(draftKey(month))
  } catch {}
}

export default function PlanEditor({ months, sellers, plans }: { months: string[]; sellers: Seller[]; plans: Plans }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(months[0])
  const [saved, setSaved] = useState<Plans>(plans)
  const fromSaved = (m: string) => Object.fromEntries(sellers.map(s => [s.amoUserId, show(saved[m]?.[s.amoUserId])]))
  const [draft, setDraft] = useState<Record<number, string>>(() => fromSaved(months[0]))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Черновик из прошлого захода восстанавливаем после монтирования: на сервере
  // localStorage нет, и разметка должна совпасть.
  useEffect(() => {
    const d = readDraft(month)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (d) { setDraft({ ...fromSaved(month), ...d }); setOpen(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changed = useMemo(
    () => sellers.filter(s => parse(draft[s.amoUserId] ?? '') !== (saved[month]?.[s.amoUserId] ?? null)),
    [sellers, draft, saved, month],
  )
  const dirty = changed.length > 0

  useEffect(() => {
    writeDraft(month, dirty ? draft : null)
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, draft, month])

  async function pickMonth(m: string) {
    if (m === month) return
    if (dirty && !(await confirmDialog({
      title: `Правки плана на ${monthName(month).toLowerCase()} не сохранены`,
      text: 'Если перейти на другой месяц, они пропадут.',
      confirmLabel: 'Перейти без сохранения',
      danger: true,
    }))) return
    writeDraft(month, null)
    setMonth(m)
    setDraft({ ...fromSaved(m), ...(readDraft(m) ?? {}) })
    setMsg(null)
  }

  async function discard() {
    if (!(await confirmDialog({
      title: 'Отменить несохранённые правки плана?',
      text: `Поля вернутся к сохранённым планам: ${changed.map(s => s.name).join(', ')}.`,
      confirmLabel: 'Отменить правки',
      danger: true,
    }))) return
    writeDraft(month, null)
    setDraft(fromSaved(month))
    setMsg(null)
  }

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const body = { month, plans: changed.map(s => ({ amoUserId: s.amoUserId, plan: parse(draft[s.amoUserId] ?? '') })) }
      const r = await fetch('/api/manager-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? `ошибка ${r.status}`)
      const next = { ...saved, [month]: { ...(saved[month] ?? {}) } }
      for (const row of j.saved as { amo_user_id: number; plan_money: number | null }[]) {
        next[month][Number(row.amo_user_id)] = row.plan_money == null ? null : Number(row.plan_money)
      }
      setSaved(next)
      writeDraft(month, null)
      setDraft(Object.fromEntries(sellers.map(s => [s.amoUserId, show(next[month]?.[s.amoUserId])])))
      setMsg({ ok: true, text: `Сохранено: план на ${monthName(month).toLowerCase()} — ${changed.map(s => s.name).join(', ')}. Менеджер видит свой план на «Утре» и в «Моих деньгах», вы — в колонке «План» этой таблицы.` })
      router.refresh()
    } catch (e) {
      setMsg({ ok: false, text: `Не сохранилось: ${(e as Error).message}. Правки остались в форме.` })
    } finally {
      setBusy(false)
    }
  }

  const total = sellers.reduce((s, x) => s + (parse(draft[x.amoUserId] ?? '') ?? 0), 0)

  return (
    <div className="bg-white border border-[#e4e4e0] rounded-xl">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-[13px] font-semibold text-[#111110]">Планы менеджеров</span>
        <span className="text-[12px] text-[#6b6b66]">{dirty ? 'есть несохранённые правки · ' : ''}{open ? 'свернуть' : 'открыть'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-[#efefeb]">
          <p className="text-[12px] text-[#6b6b66] pt-3 leading-snug">
            План месяца — в поступлениях: предоплаты + остатки из «Аналитики дохода». Пустое поле — плана нет.
          </p>
          <div className="flex gap-2">
            {months.map(m => (
              <button key={m} onClick={() => pickMonth(m)}
                className={`text-[12px] px-3 py-1 rounded-full border ${m === month ? 'bg-[#111110] text-white border-[#111110]' : 'border-[#e4e4e0] text-[#3d3d3a]'}`}>
                {monthName(m)} {m.slice(0, 4)}
              </button>
            ))}
          </div>
          <div className="divide-y divide-[#efefeb]">
            {sellers.map(s => {
              const was = saved[month]?.[s.amoUserId] ?? null
              const isChanged = changed.some(c => c.amoUserId === s.amoUserId)
              return (
                <label key={s.amoUserId} className="flex items-center gap-3 py-2">
                  <span className="text-[13px] text-[#111110] w-32 shrink-0">{s.name}</span>
                  <input inputMode="numeric" value={draft[s.amoUserId] ?? ''} placeholder="нет плана"
                    onChange={e => { const v = parse(e.target.value); setDraft(d => ({ ...d, [s.amoUserId]: v == null ? '' : v.toLocaleString('ru-RU') })); setMsg(null) }}
                    className="w-40 border border-[#e4e4e0] rounded-lg px-2.5 py-1.5 text-[13px] text-right tabular-nums" />
                  <span className="text-[12px] text-[#6b6b66]">₽</span>
                  {isChanged && <span className="text-[11px] text-amber-700">было: {was == null ? 'нет плана' : rub(was)}</span>}
                </label>
              )
            })}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={save} disabled={!dirty || busy}
              className="bg-[#111110] text-white text-[13px] font-semibold px-4 py-2 rounded-lg disabled:opacity-40">
              {busy ? 'Сохраняю…' : dirty ? `Сохранить (${changed.length})` : 'Изменений нет'}
            </button>
            {dirty && <button onClick={discard} className="text-[13px] text-[#6b6b66] hover:text-[#111110]">Отменить правки</button>}
            <span className="text-[12px] text-[#6b6b66] ml-auto">итого по команде: {rub(total)}</span>
          </div>
          {msg && <p className={`text-[12px] leading-snug ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        </div>
      )}
    </div>
  )
}
