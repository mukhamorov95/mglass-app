'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-browser'

// Развитие B2B — единая доска канала производства: гипотезы, решения, проблемы,
// чек-лист, обзвон мебельных цехов, воронка канала + брошюра и разбор колл-центра.
// Данные копятся в b2b_growth_items (миграция b2b_growth_board).

type Item = {
  id: number
  kind: 'hypothesis' | 'decision' | 'problem' | 'checklist' | 'call_target' | 'channel_stage'
  title: string
  detail: string | null
  status: string | null
  impact: string | null
  contact: string | null
  segment: string | null
  sort_order: number
  created_at: string
}

type TabKey = Item['kind'] | 'brochure' | 'callcenter'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'hypothesis', label: 'Гипотезы' },
  { key: 'checklist', label: 'Чек-лист' },
  { key: 'call_target', label: 'Обзвон цехов' },
  { key: 'channel_stage', label: 'Воронка' },
  { key: 'decision', label: 'Решения' },
  { key: 'problem', label: 'Проблемы' },
  { key: 'brochure', label: 'Брошюра' },
  { key: 'callcenter', label: 'Колл-центр' },
]

// Наборы статусов по типу
const STATUS_SETS: Partial<Record<Item['kind'], { value: string; label: string; cls: string }[]>> = {
  hypothesis: [
    { value: 'testing', label: 'Проверяем', cls: 'bg-amber-50 text-amber-700' },
    { value: 'confirmed', label: 'Подтверждена', cls: 'bg-emerald-50 text-emerald-700' },
    { value: 'rejected', label: 'Отклонена', cls: 'bg-red-50 text-red-600' },
  ],
  checklist: [
    { value: 'todo', label: 'Сделать', cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
    { value: 'done', label: 'Готово', cls: 'bg-emerald-50 text-emerald-700' },
  ],
  problem: [
    { value: 'open', label: 'Открыта', cls: 'bg-red-50 text-red-600' },
    { value: 'resolved', label: 'Решена', cls: 'bg-emerald-50 text-emerald-700' },
  ],
  call_target: [
    { value: 'new', label: 'Новый', cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
    { value: 'contacted', label: 'Дозвонились', cls: 'bg-blue-50 text-blue-600' },
    { value: 'interested', label: 'Интерес', cls: 'bg-amber-50 text-amber-700' },
    { value: 'quoted', label: 'Просчёт', cls: 'bg-indigo-50 text-indigo-600' },
    { value: 'won', label: 'Заказ', cls: 'bg-emerald-50 text-emerald-700' },
    { value: 'lost', label: 'Отказ', cls: 'bg-red-50 text-red-600' },
  ],
}

export default function B2BGrowthPage() {
  const [items, setItems] = useState<Item[]>([])
  const [tab, setTab] = useState<TabKey>('hypothesis')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [nTitle, setNTitle] = useState('')
  const [nDetail, setNDetail] = useState('')
  const [nSegment, setNSegment] = useState('')
  const [nContact, setNContact] = useState('')

  const load = useCallback(async () => {
    const { data } = await createClient().from('b2b_growth_items').select('*').order('kind').order('sort_order').order('created_at')
    setItems((data ?? []) as Item[])
    setLoading(false)
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await createClient().from('b2b_growth_items').select('*').order('kind').order('sort_order').order('created_at')
      if (alive) { setItems((data ?? []) as Item[]); setLoading(false) }
    })()
    return () => { alive = false }
  }, [])

  const byKind = (k: Item['kind']) => items.filter(i => i.kind === k)

  async function addItem(kind: Item['kind']) {
    if (!nTitle.trim()) return
    const sb = createClient()
    const defaultStatus = STATUS_SETS[kind]?.[0]?.value ?? null
    await sb.from('b2b_growth_items').insert({
      kind, title: nTitle.trim(), detail: nDetail.trim() || null,
      segment: nSegment.trim() || null, contact: nContact.trim() || null,
      status: defaultStatus, sort_order: 999,
    })
    setNTitle(''); setNDetail(''); setNSegment(''); setNContact(''); setAdding(false)
    load()
  }

  async function setStatus(id: number, status: string) {
    await createClient().from('b2b_growth_items').update({ status, updated_at: new Date().toISOString() }).eq('id', id)
    setItems(prev => prev.map(i => i.id === id ? { ...i, status } : i))
  }

  async function remove(id: number) {
    await createClient().from('b2b_growth_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  return (
    <div className="bg-[#f5f5f3] min-h-screen">
      <div className="max-w-[1000px] mx-auto px-4 py-4 space-y-4">

        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-sm font-semibold text-[#111110]">Развитие B2B — канал производства</h1>
            <p className="text-[10px] text-[#9a9a95] mt-0.5">Гипотезы, обзвон мебельных цехов, брошюра, колл-центр · всё копится здесь</p>
          </div>
          <Link href="/" className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-white">← Главная</Link>
        </div>

        {/* Табы */}
        <div className="flex gap-1 flex-wrap">
          {TABS.map(t => {
            const count = ['brochure', 'callcenter', 'channel_stage'].includes(t.key) ? null : byKind(t.key as Item['kind']).length
            return (
              <button key={t.key} onClick={() => { setTab(t.key); setAdding(false) }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tab === t.key ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#6b6b66] hover:bg-[#fafaf9]'}`}>
                {t.label}{count != null && count > 0 && <span className="ml-1 opacity-60">{count}</span>}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="text-xs text-[#9a9a95] py-8 text-center">Загрузка…</div>
        ) : tab === 'brochure' ? (
          <Brochure />
        ) : tab === 'callcenter' ? (
          <CallCenter />
        ) : tab === 'channel_stage' ? (
          <Funnel stages={byKind('channel_stage')} targets={byKind('call_target')} />
        ) : (
          <div className="space-y-2">
            {/* Добавление */}
            {adding ? (
              <div className="bg-white rounded-lg border border-[#e4e4e0] p-3 space-y-2">
                <input autoFocus value={nTitle} onChange={e => setNTitle(e.target.value)} placeholder="Заголовок"
                  className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#111110]" />
                <textarea value={nDetail} onChange={e => setNDetail(e.target.value)} placeholder="Детали (необязательно)" rows={2}
                  className="w-full border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#111110]" />
                {tab === 'call_target' && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={nSegment} onChange={e => setNSegment(e.target.value)} placeholder="Сегмент (кухни, шкафы-купе…)"
                      className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#111110]" />
                    <input value={nContact} onChange={e => setNContact(e.target.value)} placeholder="Контакт / телефон / город"
                      className="border border-[#e4e4e0] rounded-lg px-2 py-1.5 text-xs outline-none focus:border-[#111110]" />
                  </div>
                )}
                <div className="flex gap-2">
                  <button onClick={() => addItem(tab as Item['kind'])} className="px-3 py-1.5 bg-[#111110] text-white rounded-lg text-xs font-medium">Добавить</button>
                  <button onClick={() => setAdding(false)} className="px-3 py-1.5 border border-[#e4e4e0] rounded-lg text-xs text-[#6b6b66]">Отмена</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="w-full py-2 border border-dashed border-[#d4d4d0] rounded-lg text-xs text-[#9a9a95] hover:bg-white hover:text-[#6b6b66]">
                + Добавить
              </button>
            )}

            {byKind(tab as Item['kind']).map(it => (
              <Card key={it.id} item={it} onStatus={setStatus} onRemove={remove} />
            ))}
            {byKind(tab as Item['kind']).length === 0 && (
              <div className="text-xs text-[#9a9a95] py-6 text-center">Пусто. Добавьте первую запись.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ item, onStatus, onRemove }: { item: Item; onStatus: (id: number, s: string) => void; onRemove: (id: number) => void }) {
  const statuses = STATUS_SETS[item.kind]
  const cur = statuses?.find(s => s.value === item.status)
  const done = item.status === 'done' || item.status === 'resolved' || item.status === 'won'
  return (
    <div className={`bg-white rounded-lg border border-[#e4e4e0] p-3 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xs font-semibold text-[#111110] ${done ? 'line-through' : ''}`}>{item.title}</p>
          {item.detail && <p className="text-[11px] text-[#6b6b66] mt-1 leading-relaxed whitespace-pre-wrap">{item.detail}</p>}
          <div className="flex gap-2 mt-1.5 flex-wrap items-center">
            {item.segment && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{item.segment}</span>}
            {item.contact && <span className="text-[10px] text-[#9a9a95]">{item.contact}</span>}
            {item.impact && <span className="text-[10px] text-emerald-600">🎯 {item.impact}</span>}
          </div>
        </div>
        {cur && <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${cur.cls}`}>{cur.label}</span>}
      </div>
      {statuses && (
        <div className="flex gap-1 mt-2 flex-wrap">
          {statuses.map(s => (
            <button key={s.value} onClick={() => onStatus(item.id, s.value)}
              className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${item.status === s.value ? s.cls + ' font-semibold' : 'text-[#9a9a95] hover:bg-[#f0f0ec]'}`}>
              {s.label}
            </button>
          ))}
          <button onClick={() => onRemove(item.id)} className="ml-auto text-[10px] text-[#c4c4be] hover:text-red-500">удалить</button>
        </div>
      )}
    </div>
  )
}

function Funnel({ stages, targets }: { stages: Item[]; targets: Item[] }) {
  const stageMap: Record<string, string[]> = {
    'Обзвон': ['new'], 'Интерес': ['contacted', 'interested'], 'Просчёт': ['quoted'],
    'Первый заказ': ['won'], 'Постоянный': [],
  }
  const countAt = (title: string) => targets.filter(t => (stageMap[title] ?? []).includes(t.status ?? '')).length
  const total = targets.length || 1
  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] p-4 space-y-3">
      <p className="text-[10px] font-semibold text-[#9a9a95] uppercase tracking-widest">Воронка канала обзвона</p>
      {stages.map(s => {
        const c = countAt(s.title)
        const pct = Math.round(c / total * 100)
        return (
          <div key={s.id}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className="font-medium text-[#111110]">{s.title}</span>
              <span className="text-[#9a9a95]">{c} · {pct}%</span>
            </div>
            <div className="h-2 bg-[#f0f0ec] rounded-full overflow-hidden">
              <div className="h-full bg-[#111110] rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            {s.detail && <p className="text-[10px] text-[#9a9a95] mt-0.5">{s.detail}</p>}
          </div>
        )
      })}
      <p className="text-[10px] text-[#9a9a95] pt-2 border-t border-[#f0f0ec]">
        Цифры считаются по статусам целей во вкладке «Обзвон цехов». Веди статусы там — воронка обновится сама.
      </p>
    </div>
  )
}

function Brochure() {
  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] p-6 space-y-5 print:border-0">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-lg font-bold text-[#111110]">M-Glass · Производство</h2>
          <p className="text-sm text-[#6b6b66] mt-0.5">Стекло и зеркало под нарезку для мебельных производств</p>
        </div>
        <button onClick={() => window.print()} className="px-3 py-1.5 text-xs border border-[#e4e4e0] rounded-lg text-[#6b6b66] hover:bg-[#fafaf9] print:hidden">🖨 Печать</button>
      </div>

      <div className="grid md:grid-cols-2 gap-4 text-sm">
        <div className="space-y-2">
          <h3 className="font-semibold text-[#111110]">Что режем</h3>
          <ul className="text-[13px] text-[#4b4b47] space-y-1 leading-relaxed">
            <li>• Осветлённое и обычное стекло 4–12 мм</li>
            <li>• Зеркало (серебро, осветлённое, тонированное, состаренное)</li>
            <li>• Сатин (матовое), рифлёное, лакобель</li>
            <li>• Тонированное в массе (бронза, графит)</li>
          </ul>
          <h3 className="font-semibold text-[#111110] pt-2">Обработка</h3>
          <ul className="text-[13px] text-[#4b4b47] space-y-1 leading-relaxed">
            <li>• Закалка (безопасное стекло)</li>
            <li>• Полировка кромки по периметру</li>
            <li>• Сверловка отверстий</li>
            <li>• Фацет 10/15/20 мм</li>
          </ul>
        </div>
        <div className="space-y-2">
          <h3 className="font-semibold text-[#111110]">Под мебель — идеально</h3>
          <ul className="text-[13px] text-[#4b4b47] space-y-1 leading-relaxed">
            <li>• Партии от десятков до <b>тысяч одинаковых деталей</b></li>
            <li>• Лист 3210×2250 мм — плотный раскрой типовых размеров</li>
            <li>• Зеркала в двери шкафов-купе, фартуки-скинали для кухонь, стеклянные фасады, полки, витрины</li>
            <li>• Свой цех: резка → закалка → кромка → сверловка → упаковка</li>
          </ul>
          <div className="bg-[#f5f5f3] rounded-lg p-3 mt-2">
            <p className="text-[13px] text-[#111110] font-semibold">Почему выгодно на объёме</p>
            <p className="text-[12px] text-[#6b6b66] mt-1 leading-relaxed">Оборудование и мастера — фиксированная стоимость. Чем больше партия, тем ниже цена за деталь. На типовых прямоугольниках даём конкурентную цену за м² с коротким сроком.</p>
          </div>
        </div>
      </div>

      <div className="border-t border-[#f0f0ec] pt-4 grid md:grid-cols-3 gap-3 text-[13px]">
        <div><span className="text-[#9a9a95]">Минимальная партия</span><br /><b className="text-[#111110]">обсуждается под задачу</b></div>
        <div><span className="text-[#9a9a95]">Срок</span><br /><b className="text-[#111110]">от 2–5 рабочих дней</b></div>
        <div><span className="text-[#9a9a95]">Цена</span><br /><b className="text-[#111110]">за м², по спецификации</b></div>
      </div>

      <div className="bg-[#111110] text-white rounded-lg p-4 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-sm font-semibold">Пришлите спецификацию — сделаем просчёт в тот же день</p>
          <p className="text-xs text-white/70 mt-0.5">Список деталей: материал, размеры, количество, обработка</p>
        </div>
        <div className="text-right text-xs text-white/80">
          <p>Телефон: ____________</p>
          <p>Почта / мессенджер: ____________</p>
        </div>
      </div>
      <p className="text-[10px] text-[#c4c4be] print:hidden">Контакты и минимальную партию впишите под свою политику перед печатью/отправкой.</p>
    </div>
  )
}

function CallCenter() {
  return (
    <div className="bg-white rounded-lg border border-[#e4e4e0] p-5 space-y-5 text-sm">
      <h2 className="text-base font-bold text-[#111110]">Аутсорс-колл-центр — как это работает</h2>

      <Section title="Идея">
        Внешние операторы обзванивают мебельные цеха по нашему списку и скрипту, снимают потребность (что режут, какие объёмы),
        передают тёплый контакт нам. Наш B2B-менеджер уже делает просчёт и ведёт до заказа. Холодный обзвон — самая монотонная
        часть, её выгодно отдать; продажу и просчёт оставляем себе.
      </Section>

      <Section title="Скрипт (каркас)">
        <ol className="list-decimal ml-4 space-y-1 text-[13px] text-[#4b4b47]">
          <li>Кто мы: «M-Glass, своё производство — режем стекло и зеркало под мебель».</li>
          <li>Вопрос-крючок: «Заказываете стекло/зеркало под свои изделия? Где сейчас режете?»</li>
          <li>Ценность: партии любого объёма, закалка/кромка/сверловка, цена за м², короткий срок.</li>
          <li>Цель звонка: получить контакт закупщика + согласие прислать брошюру и сделать пробный просчёт.</li>
          <li>Закрытие: «Пришлите спецификацию — просчитаем сегодня». Передаём в CRM с источником «обзвон».</li>
        </ol>
      </Section>

      <Section title="Объёмы и KPI">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[13px]">
          <Kpi label="Звонков в день" value="50–100" />
          <Kpi label="Дозвон" value="30–50%" />
          <Kpi label="Интерес" value="5–10%" />
          <Kpi label="В просчёт" value="2–4%" />
        </div>
        <p className="text-[12px] text-[#6b6b66] mt-2">С 1000 звонков в месяц при 3% в просчёт — это ~30 просчётов. Даже при конверсии просчёт→заказ 20% — 6 новых B2B-клиентов в месяц, каждый с повторными заказами.</p>
      </Section>

      <Section title="Модель оплаты">
        <ul className="text-[13px] text-[#4b4b47] space-y-1">
          <li>• <b>За звонок/минуту</b> — предсказуемо, но платишь и за пустые.</li>
          <li>• <b>За лид</b> (переданный тёплый контакт) — дороже за штуку, но платишь за результат. Предпочтительно на старте.</li>
          <li>• <b>Оклад+бонус</b> за квалифицированный лид — если берём своего оператора вместо аутсорса.</li>
        </ul>
      </Section>

      <Section title="Свой оператор vs аутсорс">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="bg-[#f5f5f3] rounded-lg p-3">
            <p className="font-semibold text-[#111110] text-[13px]">Аутсорс</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">Быстрый старт, готовая инфраструктура, легко масштабировать/остановить. Минус — меньше контроля над качеством разговора, нужен чёткий скрипт и прослушка.</p>
          </div>
          <div className="bg-[#f5f5f3] rounded-lg p-3">
            <p className="font-semibold text-[#111110] text-[13px]">Свой</p>
            <p className="text-[12px] text-[#6b6b66] mt-1">Лучше знает продукт, гибче в диалоге, дешевле на объёме. Минус — найм, обучение, рабочее место, дольше запуск.</p>
          </div>
        </div>
        <p className="text-[12px] text-[#6b6b66] mt-2">Рекомендация: пилот 200–300 звонков силами существующего B2B-менеджера или разового аутсорса «за лид». По конверсии решить, что масштабировать.</p>
      </Section>

      <Section title="Интеграция с системой">
        Лиды с обзвона заводятся в CRM с источником «обзвон» — так видно конверсию канала отдельно от Авито. Тёплый контакт →
        B2B-менеджер → калькулятор → КП → заказ. Статусы целей ведутся во вкладке «Обзвон цехов», сводка — во вкладке «Воронка».
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h3 className="font-semibold text-[#111110] text-[13px]">{title}</h3>
      <div className="text-[13px] text-[#4b4b47] leading-relaxed">{children}</div>
    </div>
  )
}
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#f5f5f3] rounded-lg px-2 py-2 text-center">
      <p className="text-[10px] text-[#9a9a95]">{label}</p>
      <p className="text-sm font-bold text-[#111110] font-mono">{value}</p>
    </div>
  )
}
