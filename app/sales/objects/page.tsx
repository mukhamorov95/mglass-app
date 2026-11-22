import Link from 'next/link'
import { redirect } from 'next/navigation'
import { canMargin, getSessionUser, getUserProfile, isOwnerRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { pageAll } from '@/lib/supabase/pageAll'
import { mskDayKey } from '@/lib/time'
import { loadMarginMonths, type MarginObject } from '@/lib/sales/marginBook'
import { installsOf, marginStateOf, OBJECTS_FROM, sameManager, stageOf, STAGE_RU, type ObjInstall, type Stage } from '@/lib/realization/objects'

// Объекты M-Glass (Р1 docs/B2C_OBJECT_ROUTE.md): каждая продажа с 01.08 — стадия, оплата,
// маржа, монтаж. Отдел реализации (Вера, Дима — право «Маржа»), CFO и владелец видят все
// объекты; менеджер — свои. Маржу объекта видят все они (решение владельца 22.11).

export const dynamic = 'force-dynamic'

type Sale = {
  id: number; order_no: string | null; client: string | null; manager: string | null; amount: number | null
  sale_date: string; status: string | null; remainder_paid: boolean | null; prepayment_paid: boolean | null
  ledger_month: string | null; product_type: string | null
}

const rub = (n: number) => Math.round(n).toLocaleString('ru-RU')
const dm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}` : '—')
const pct1 = (n: number) => Math.round(n * 10) / 10
// Цвет — по напечатанному значению (пороги маржи проекта: < 25 красный, 25–35 жёлтый).
const mCls = (n: number) => (pct1(n) < 25 ? 'text-red-600' : pct1(n) < 35 ? 'text-amber-600' : 'text-emerald-700')
const PRODUCT: Record<string, string> = { shower: 'душевая', mirror: 'зеркало', loft: 'лофт', partition: 'перегородка', other: 'другое' }
const product = (p: string | null) => (p ? p.split(',').map(x => PRODUCT[x] ?? x).join(' + ') : '—')
const STAGES: Stage[] = ['work', 'montage_planned', 'mounted', 'done']

export default async function ObjectsPage({ searchParams }: { searchParams: Promise<{ stage?: string; mgr?: string; m?: string }> }) {
  const [profile, user] = await Promise.all([getUserProfile(), getSessionUser()])
  if (!profile || !user) redirect('/login')
  const seeAll = isOwnerRole(profile.role) || profile.role === 'cfo' || canMargin(profile.role, profile.permissions)
  const isManager = profile.role === 'manager' || (profile.role === 'buyer' && profile.permissions.manager_workspace === true)
  if (!seeAll && !isManager) redirect('/sales')
  const canEdit = canMargin(profile.role, profile.permissions)

  // Service-role: доступ проверен выше; менеджеру ниже оставляем только его продажи.
  const svc = createServiceClient()
  const myName = seeAll ? null : (await svc.from('users').select('name').eq('id', user.id).maybeSingle()).data?.name ?? null

  const today = mskDayKey()
  const sp = await searchParams
  const errors: string[] = []

  const sales = await pageAll<Sale>((from, to) => svc.from('crm_sales')
    .select('id, order_no, client, manager, amount, sale_date, status, remainder_paid, prepayment_paid, ledger_month, product_type')
    .eq('department', 'mglass').eq('voided', false).gte('sale_date', OBJECTS_FROM)
    .order('sale_date', { ascending: false }).order('id').range(from, to))
    .catch((e: Error) => { errors.push(`Продажи не загрузились: ${e.message}`); return [] as Sale[] })
  const mine = seeAll ? sales : sales.filter(s => sameManager(s.manager, myName))

  const months = [...new Set(mine.map(s => s.ledger_month).filter((m): m is string => !!m))]
  const marginBySale = new Map<number, MarginObject>()
  if (months.length) {
    try {
      const { byMonth, editsError } = await loadMarginMonths(svc, months)
      for (const o of byMonth.flatMap(x => x.objects)) if (o.sale_id != null) marginBySale.set(o.sale_id, o)
      if (editsError) errors.push(`Правки маржи из приложения не загрузились: ${editsError}`)
    } catch (e) {
      errors.push(`Маржа не загрузилась: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const { data: instData, error: instError } = await svc.from('installations').select('order_no, order_nos, scheduled_date, status, kind, crew_members')
  if (instError) errors.push(`Монтажи не загрузились: ${instError.message}`)
  const installs = (instData ?? []) as ObjInstall[]
  const lastInstall = installs.map(i => i.scheduled_date).filter(Boolean).sort().at(-1) ?? null

  const objects = mine.map(s => {
    const mo = marginBySale.get(s.id)
    const closed = mo ? mo.closed : s.status === 'closed'
    const ins = installsOf(s.order_no, installs)
    const { stage, montageDate } = stageOf(closed, ins, today)
    const crew = ins.find(i => i.scheduled_date === montageDate)?.crew_members ?? []
    return { s, stage, montageDate, crew, margin: marginErrorFree(errors) ? marginStateOf(mo) : null }
  })

  const managers = [...new Set(sales.map(s => s.manager).filter((m): m is string => !!m))].sort()
  const stageF = STAGES.find(x => x === sp.stage) ?? null
  const shown = objects
    .filter(o => !stageF || o.stage === stageF)
    .filter(o => !seeAll || !sp.mgr || o.s.manager === sp.mgr)
    .filter(o => sp.m !== 'none' || (o.margin && o.margin.kind !== 'ok'))

  const count = (f: (o: (typeof objects)[number]) => boolean) => objects.filter(f).length
  const inWork = count(o => o.stage !== 'done')
  const planned = count(o => o.stage === 'montage_planned')
  const noMargin = count(o => o.margin?.kind === 'none')
  const partial = count(o => o.margin?.kind === 'partial')

  const href = (p: { stage?: string | null; mgr?: string | null; m?: string | null }) => {
    const q = new URLSearchParams()
    const v = { stage: sp.stage ?? null, mgr: sp.mgr ?? null, m: sp.m ?? null, ...p }
    for (const [k, x] of Object.entries(v)) if (x) q.set(k, x)
    return `/sales/objects${q.size ? `?${q}` : ''}`
  }
  const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-[12px] font-medium border ${on ? 'bg-[#111110] text-white border-[#111110]' : 'bg-white text-[#6b6b66] border-[#e4e4e0] hover:border-[#111110]'}`
  const tile = 'bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 hover:border-[#111110]'

  return (
    <div className="min-h-screen bg-[#f8f8f7] pb-20">
      <div className="mx-auto max-w-6xl p-4 sm:p-6">
        <h1 className="text-xl font-semibold text-[#111110]">{seeAll ? 'Объекты M-Glass' : 'Мои объекты'}</h1>
        <p className="mt-1 text-sm text-[#9a9a95]">
          Каждая продажа с 01.08.2026 из книги «Продажи» — от продажи до сдачи. {seeAll ? 'Все менеджеры.' : `Менеджер: ${myName ?? '—'}.`}
        </p>

        {errors.map(e => (
          <div key={e} className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{e} Обновите страницу.</div>
        ))}
        {!seeAll && !myName && (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">У вашей учётной записи не указано имя — не с чем сверить менеджера в книге продаж.</div>
        )}

        <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href={href({ stage: null, m: null })} className={tile}>
            <div className="text-xs text-[#9a9a95]">В реализации</div>
            <div className="text-2xl font-semibold tabular-nums">{inWork}</div>
            <div className="text-xs text-[#9a9a95]">из {objects.length} объектов, сдано {objects.length - inWork}</div>
          </Link>
          <Link href={href({ stage: 'montage_planned' })} className={tile}>
            <div className="text-xs text-[#9a9a95]">Монтаж назначен</div>
            <div className="text-2xl font-semibold tabular-nums">{planned}</div>
            <div className="text-xs text-[#9a9a95]">выезды календаря по {dm(lastInstall)}</div>
          </Link>
          <Link href={href({ m: 'none', stage: null })} className={tile}>
            <div className="text-xs text-[#9a9a95]">Маржа не внесена</div>
            <div className={`text-2xl font-semibold tabular-nums ${noMargin ? 'text-red-600' : ''}`}>{noMargin}</div>
            <div className="text-xs text-[#9a9a95]">нет ни одного расхода</div>
          </Link>
          <Link href={href({ m: 'none', stage: null })} className={tile}>
            <div className="text-xs text-[#9a9a95]">Расходы внесены не все</div>
            <div className={`text-2xl font-semibold tabular-nums ${partial ? 'text-amber-600' : ''}`}>{partial}</div>
            <div className="text-xs text-[#9a9a95]">маржа ещё не окончательная</div>
          </Link>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Link href={href({ stage: null })} className={chip(!stageF)}>Все стадии</Link>
          {STAGES.map(st => <Link key={st} href={href({ stage: st })} className={chip(stageF === st)}>{STAGE_RU[st]}</Link>)}
          <Link href={href({ m: sp.m === 'none' ? null : 'none' })} className={chip(sp.m === 'none')}>Маржа не посчитана</Link>
        </div>
        {seeAll && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link href={href({ mgr: null })} className={chip(!sp.mgr)}>Все менеджеры</Link>
            {managers.map(m => <Link key={m} href={href({ mgr: m })} className={chip(sp.mgr === m)}>{m}</Link>)}
          </div>
        )}

        <section className="mt-4 overflow-x-auto rounded-xl border border-[#e4e4e0] bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[#9a9a95]">
              <tr>
                <th className="px-4 py-3 font-medium">Заказ</th>
                <th className="px-2 py-3 font-medium">Продан</th>
                {seeAll && <th className="px-2 py-3 font-medium">Менеджер</th>}
                <th className="px-2 py-3 font-medium">Изделие</th>
                <th className="px-2 py-3 text-right font-medium">Сумма, ₽</th>
                <th className="px-2 py-3 font-medium">Стадия</th>
                <th className="px-2 py-3 font-medium">Монтаж</th>
                <th className="px-4 py-3 font-medium">Маржа</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ s, stage, montageDate, crew, margin }) => (
                <tr key={s.id} className="border-t border-[#e4e4e0] align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium tabular-nums">{s.order_no ?? '—'}</div>
                    <div className="text-xs text-[#9a9a95]">{s.client ?? ''}</div>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{dm(s.sale_date)}</td>
                  {seeAll && <td className="px-2 py-2">{s.manager ?? '—'}</td>}
                  <td className="px-2 py-2">{product(s.product_type)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{s.amount == null ? '—' : rub(Number(s.amount))}</td>
                  <td className="px-2 py-2">
                    <div>{STAGE_RU[stage]}</div>
                    {stage !== 'done' && <div className="text-xs text-[#9a9a95]">{s.prepayment_paid ? 'аванс получен' : 'аванса нет'} · остаток не оплачен</div>}
                  </td>
                  <td className="px-2 py-2 tabular-nums">
                    {montageDate ? <>{dm(montageDate)}{crew.length > 0 && <div className="text-xs text-[#9a9a95]">{crew.join(', ')}</div>}</> : <span className="text-[#9a9a95]">нет в календаре</span>}
                  </td>
                  <td className="px-4 py-2">
                    {margin == null ? <span className="text-[#9a9a95]">—</span>
                      : margin.kind === 'ok' ? <span className={`font-medium tabular-nums ${margin.pct == null ? '' : mCls(margin.pct)}`}>{margin.pct == null ? '—' : `${pct1(margin.pct).toLocaleString('ru-RU', { minimumFractionDigits: 1 })} %`}</span>
                      : margin.kind === 'none' ? <span className="text-red-600">не внесена</span>
                      : <span className="text-amber-700">нет: {margin.missing.join(', ')}</span>}
                    {margin && margin.kind !== 'ok' && canEdit && s.ledger_month && (
                      <div><Link href={`/sales/margin?mode=month&month=${s.ledger_month}`} className="text-xs text-[#0071e3] hover:underline">внести расходы →</Link></div>
                    )}
                  </td>
                </tr>
              ))}
              {shown.length === 0 && errors.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-6 text-center text-[#9a9a95]">Объектов с такими условиями нет.</td></tr>
              )}
            </tbody>
          </table>
        </section>
        <p className="mt-2 text-xs text-[#9a9a95]">
          Стадия выводится из данных: «Сдан» — заказ закрыт в продажах; «Монтаж назначен» и «Смонтирован» — по выездам календаря
          монтажей (загружены по {dm(lastInstall)}, ежедневная загрузка — следующий этап). Маржа — от суммы продажи, по расходам книги
          «Маржа» и внесённым в приложении; окончательная, когда внесены стекло, фурнитура, конструктор, замерщик, монтажник и доставка.
        </p>
      </div>
    </div>
  )
}

// Маржу при сбое её загрузки не показываем вовсе: «не внесена» по пустым данным была бы ложью.
function marginErrorFree(errors: string[]) {
  return !errors.some(e => e.startsWith('Маржа') || e.startsWith('Продажи'))
}
