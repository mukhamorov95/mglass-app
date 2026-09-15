import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'
import { createClient } from '@/lib/supabase-server'
import { createServiceClient } from '@/lib/supabase-service'
import { PROD_SINCE } from '@/lib/orderFlags'
import { stageLabel } from '@/lib/productionStages'
import { shopHome, type ShopTask, type ShopOrder, type ShopOrderRow } from '@/lib/production/shopHome'

// Главная цеха (ТЗ 4.3, маршрут Н3). Раньше адрес сразу уводил в «Мои задачи»
// (решение 14.07); теперь сверху те же «Мои задачи» одной кнопкой, а ниже — что
// горит по цеху. Только чтение. Доступ гейтит production-app/layout.tsx, поэтому
// сервисный клиент здесь — после проверки роли.

export const dynamic = 'force-dynamic'

const PAGE = 1000

export default async function ProductionHome() {
  const sb = await createClient()
  const { data: { user } } = await sb.auth.getUser()
  const svc = createServiceClient()

  // PostgREST молча режет ответ до 1000 строк — читаем страницами
  const tasks: ShopTask[] = []
  for (let from = 0; ; from += PAGE) {
    const { data } = await svc.from('production_tasks')
      .select('order_id,station,stage_key,status,assigned_to,started_by_name,completed_at,completed_by_name')
      .order('id').range(from, from + PAGE - 1)
    const page = (data ?? []) as ShopTask[]
    tasks.push(...page)
    if (page.length < PAGE) break
  }

  const [{ data: orderData }, { count: reqOpen }, { data: me }] = await Promise.all([
    svc.from('b2b_orders')
      .select('id,client_name,custom_number,notes,launched_at,created_at')
      .is('archived_at', null).not('launched_at', 'is', null).gte('created_at', PROD_SINCE)
      .order('id', { ascending: false }).limit(2000),
    svc.from('shop_purchase_requests').select('id', { count: 'exact', head: true }).neq('status', 'arrived'),
    user ? svc.from('users').select('production_stations').eq('id', user.id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const h = shopHome({
    tasks,
    orders: (orderData ?? []) as ShopOrder[],
    purchaseRequestsOpen: reqOpen ?? 0,
    me: { id: user?.id ?? null, stations: (me as { production_stations?: string[] | null } | null)?.production_stations ?? null },
  })

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Цех сегодня</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Мои задачи, что горит и что уезжает — по отметкам цеха</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-5xl space-y-3">
        {/* 1. Мои задачи — первое действие смены, поэтому крупно и одной кнопкой */}
        <Link href="/production-app/my-queue"
          className="block bg-[#111110] text-white rounded-2xl px-4 py-4 hover:bg-[#2a2a28] transition-colors">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12px] text-[#c4c4be]">{h.my.scope === 'mine' ? 'Мои задачи — мои станции' : 'Задачи по всему цеху'}</p>
              <p className="text-[28px] font-bold font-mono leading-tight">{h.my.open}</p>
              <p className="text-[12px] text-[#c4c4be]">
                в работе {h.my.inProgress}{h.my.problems > 0 && <> · <span className="text-red-300">проблем {h.my.problems}</span></>}
                {h.my.byStation.length > 0 && <> · {h.my.byStation.slice(0, 4).map(s => `${stageLabel(s.station)} ${s.count}`).join(' · ')}</>}
              </p>
            </div>
            <span className="shrink-0 text-[14px] font-semibold bg-white text-[#111110] rounded-xl px-4 py-2.5">Открыть →</span>
          </div>
        </Link>

        <div className="grid gap-3 md:grid-cols-2">
          <Block title="Срочные и просроченные" href="/production-app/load" tone="red"
            stat={`${h.urgent.overdue + h.urgent.today}`}
            sub={`просрочено ${h.urgent.overdue} · срок сегодня ${h.urgent.today}${h.urgent.flagged ? ` · помечено срочным ${h.urgent.flagged}` : ''} · сроки с 01.09, когда вернулась отметка отгрузки`}
            rows={h.urgent.rows} empty="Ничего не горит" />
          <Block title="Отгрузка сегодня" href="/production-app/shipping" tone="emerald"
            stat={`${h.shipping.ready}`}
            sub={`готово к отгрузке · уже отгружено сегодня ${h.shipping.shippedToday}`}
            rows={h.shipping.rows} empty="Готовых к отгрузке нет" />
          <Block title="Заказы в работе" href="/production-app/orders" tone="plain"
            stat={`${h.inWork.count}`} sub="есть незакрытые этапы · ближайшие по сроку"
            rows={h.inWork.rows} empty="Заказов в работе нет" />
          <Block title="Материал и дефицит" href="/production-app/material" tone="amber"
            stat={`${h.material.orders}`} sub={`заказов ждут материал · заявок на закупку открыто ${h.material.requestsOpen}`}
            rows={h.material.rows} empty="Все заказы с материалом" />
        </div>

        {/* 6. Загрузка людей. Оборудования нет: мощность станций не заведена (маршрут Ф5) */}
        <div className="bg-white border border-[#e4e4e0] rounded-2xl px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[14px] font-bold text-[#111110]">Загрузка людей</p>
            <Link href="/production-app/activity" className="text-[12px] text-blue-600 hover:underline">Кто что делал →</Link>
          </div>
          {h.people.length === 0 ? (
            <p className="text-[12px] text-[#9a9a95] mt-1">Сегодня отметок ещё нет.</p>
          ) : (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {h.people.map(p => (
                <div key={p.name} className="flex items-center justify-between gap-2 text-[13px] border border-[#f0f0ec] rounded-lg px-3 py-1.5">
                  <span className="truncate text-[#111110]">{p.name}</span>
                  <span className="font-mono text-[12px] text-[#6b6b66] whitespace-nowrap">закрыл {p.doneToday} · в работе {p.inProgress}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[11px] text-[#9a9a95] mt-2">Загрузка оборудования появится, когда будет заведена мощность станций.</p>
        </div>
      </div>
    </div>
  )
}

const TONE = {
  red: 'border-red-200', amber: 'border-amber-200', emerald: 'border-emerald-200', plain: 'border-[#e4e4e0]',
} as const

function Block({ title, href, tone, stat, sub, rows, empty }: {
  title: string; href: string; tone: keyof typeof TONE; stat: string; sub: string; rows: ShopOrderRow[]; empty: string
}) {
  return (
    <div className={`bg-white border ${TONE[tone]} rounded-2xl overflow-hidden`}>
      <Link href={href} className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-[#fafaf9]">
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-[#111110]">{title}</p>
          <p className="text-[11px] text-[#8a8a85] mt-0.5">{sub}</p>
        </div>
        <span className="text-[22px] font-bold font-mono text-[#111110] leading-none">{stat}</span>
      </Link>
      {rows.length === 0 ? (
        <p className="px-4 pb-3 text-[12px] text-[#9a9a95]">{empty}</p>
      ) : (
        <div className="divide-y divide-[#f0f0ec] border-t border-[#f0f0ec]">
          {rows.map(r => (
            <Link key={r.id} href={`/production-app/orders/${r.id}`}
              className="flex items-center justify-between gap-3 px-4 py-2 min-h-[44px] hover:bg-[#fafaf9]">
              <span className="text-[13px] text-[#111110] truncate"><span className="font-mono">{r.ref}</span> · {r.client}</span>
              <span className="text-[11px] text-[#6b6b66] whitespace-nowrap">{r.note}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
