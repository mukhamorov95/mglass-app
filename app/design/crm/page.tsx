import { CRM_ZONES } from '@/lib/crmStages'

// ПУБЛИЧНАЯ ДЕМО-СТРАНИЦА CRM (без логина — путь /design/ в whitelist middleware).
// Нужна, чтобы отдать внешнему дизайн-инструменту вид страницы для редизайна.
// ВСЕ ДАННЫЕ ВЫМЫШЛЕННЫЕ. Реальную CRM и данные клиентов не раскрывает:
// никаких запросов к БД/API, ничего с сервера — чистая презентационная вёрстка
// теми же классами и палитрой, что боевой /crm.

export const metadata = { title: 'MGlass CRM — демо дизайна', robots: 'noindex' }

type L = { id: number; name: string; product?: string; sizes?: string; source: string; manager: string; sum?: number; stage: string; qualified?: boolean; overdue?: boolean; won?: boolean; lost?: boolean }

const SRC: Record<string, string> = { avito: 'Авито', call: 'Звонок', whatsapp: 'WhatsApp', site: 'Сайт', manual: 'Вручную', referral: 'Рекомендация' }
const RUB = (n: number) => n.toLocaleString('ru-RU')

const LEADS: L[] = [
  { id: 101, name: '+7 (925) 470-11-08', source: 'call', manager: 'Семён', stage: 'Получена новая заявка' },
  { id: 102, name: 'Дарья', product: 'Душевая перегородка', sizes: '900×2000 мм', source: 'avito', manager: 'Яна', sum: 38900, stage: 'Получена новая заявка' },
  { id: 103, name: 'Игорь', product: 'Лофт-перегородка', sizes: '2300×2850 мм', source: 'avito', manager: 'Александра', sum: 41200, stage: 'Назначен ответственный' },
  { id: 104, name: 'Марина', product: 'Зеркало с подсветкой', sizes: '800×1200 мм', source: 'whatsapp', manager: 'Алина', sum: 12975, stage: 'Проработка', qualified: true },
  { id: 105, name: 'Сергей · дизайнер', product: 'Душевая перегородка', sizes: '900×2000 мм', source: 'avito', manager: 'Семён', sum: 39335, stage: 'Разговор состоялся', qualified: true },
  { id: 106, name: 'Ольга', product: 'Зеркало с фацетом', sizes: '600×900 мм', source: 'site', manager: 'Яна', sum: 21400, stage: 'Готов купить', qualified: true, overdue: true },
  { id: 107, name: 'Артём', product: 'Душевая, угловая', sizes: '900×900×2000 мм', source: 'avito', manager: 'Александра', sum: 74900, stage: 'Замер назначен', qualified: true },
  { id: 108, name: 'Ниёле · дизайнер', product: 'Лофт-перегородка, 4 секции', sizes: '3200×2850 мм', source: 'referral', manager: 'Семён', sum: 128600, stage: 'КП отправлено', qualified: true },
  { id: 109, name: 'ЖК «Символ» · прораб', product: 'Душевые ×4', sizes: 'по проекту', source: 'avito', manager: 'Алина', sum: 312000, stage: 'Счёт выставлен — ждём оплату', qualified: true },
  { id: 110, name: 'Владислав', product: 'Зеркала ×3', sizes: 'разные', source: 'manual', manager: 'Яна', sum: 46700, stage: 'Заказ в работе' },
]

const TASKS = [
  { icon: '📞', title: 'Перезвонить — Ольга, уточнить по подсветке', who: 'Яна', when: 'просрочено · сегодня 12:30', overdue: true, lead: 'Ольга' },
  { icon: '📐', title: 'Замер — Артём, ЖК «Прайм»', who: 'Александра', when: 'сегодня · 18:00', overdue: false, lead: 'Артём' },
]

const ACTS = [
  { icon: '📞', who: '+7 (925) 470-11-08', text: 'Входящий звонок · 1:24', time: '16:41', author: 'Семён' },
  { icon: '💬', who: 'Дарья', text: 'КЛИЕНТ: Здравствуйте! Сколько будет душевая 90×200?', time: '16:35', author: 'Иван (AI)' },
  { icon: '💬', who: 'Дарья', text: 'БОТ: Здравствуйте! Такая душевая выйдет примерно 38 900 ₽. Подскажете город?', time: '16:35', author: 'Иван (AI)' },
  { icon: '➡️', who: 'Сергей · дизайнер', text: 'Этап: Проработка → Разговор состоялся', time: '16:12', author: 'Семён' },
  { icon: '📝', who: 'Артём', text: 'Договорились на замер в четверг, дом с пропуском', time: '15:58', author: 'Александра' },
  { icon: '📞', who: 'Ольга', text: '📵 Пропущенный звонок', time: '15:40', author: null },
  { icon: '🗓', who: 'Ниёле · дизайнер', text: 'Задача: Отправить КП по лофту 4 секции', time: '15:20', author: 'Семён' },
]

export default function DesignCrmDemo() {
  const byStage = new Map<string, L[]>()
  for (const l of LEADS) byStage.set(l.stage, [...(byStage.get(l.stage) ?? []), l])
  const keyCount = LEADS.filter(l => l.qualified).length
  const card = LEADS[4] // Сергей · дизайнер — образец карточки

  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-amber-50 border-b border-amber-200 px-5 py-2 text-[12px] text-amber-800 text-center">
        Демо-страница дизайна CRM · все данные вымышленные · реальные клиенты не отображаются
      </div>

      {/* ===================== ДОСКА-ВОРОНКА ===================== */}
      <div className="bg-white border-b border-[#e4e4e0] px-5 pt-6 pb-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">📊 CRM · Продажи</h1>
            <p className="text-[13px] text-[#9a9a95] mt-0.5">Активных: {LEADS.length} · ⭐ ключевой этап: {keyCount}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="search" placeholder="Поиск: имя / телефон" className="border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] bg-white w-48 outline-none focus:border-[#111110]" />
            <select className="border border-[#e4e4e0] rounded-lg px-2.5 py-2 text-[13px] bg-white" defaultValue="all">
              <option value="all">Все источники</option>
              {Object.entries(SRC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[12px] text-[#6b6b66]"><input type="checkbox" className="accent-[#111110]" /> закрытые</label>
            <button className="px-4 py-2.5 rounded-xl border border-[#e4e4e0] bg-white text-[#111110] text-[13px] font-semibold hover:bg-[#f5f5f3]">⬇ Импорт с Авито</button>
            <button className="px-4 py-2.5 rounded-xl bg-[#111110] text-white text-[13px] font-semibold hover:opacity-90">＋ Лид</button>
          </div>
        </div>
      </div>

      {/* Приём лидов (владельцу) */}
      <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="text-[12px] font-semibold text-[#111110]">Приём лидов:</span>
        <div className="inline-flex bg-[#f0f0ec] rounded-lg p-0.5">
          <button className="px-3 py-1.5 rounded-md text-[12px] font-medium bg-white text-[#111110] shadow-sm">Только Авито</button>
          <button className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[#6b6b66]">Все каналы (AmoCRM)</button>
        </div>
        <button className="px-3 py-1.5 rounded-lg border border-[#e4e4e0] text-[12px] font-medium text-[#111110] hover:bg-[#f5f5f3]">↻ Синхронизировать с AmoCRM</button>
        <span className="text-[11px] text-[#c4c4be] ml-auto">AmoCRM — только чтение. Заливает активные сделки воронки «Продажи».</span>
      </div>

      {/* Задачи на сегодня и просроченные */}
      <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
        <p className="text-[12px] font-semibold text-[#111110] mb-2">🗓 Задачи на сегодня и просроченные · {TASKS.length}</p>
        <div className="space-y-1.5">
          {TASKS.map((t, i) => (
            <div key={i} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${t.overdue ? 'bg-red-50' : 'bg-[#f6f8ff]'}`}>
              <span className="w-5 h-5 rounded-full border border-[#c4c4be] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[#111110] truncate">{t.icon} {t.title} <span className="text-[#9a9a95]">— {t.lead}</span></p>
                <p className={`text-[10px] ${t.overdue ? 'text-red-600 font-semibold' : 'text-[#9a9a95]'}`}>{t.when} · {t.who}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Лента активности */}
      <div className="mx-5 mt-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <span className="text-[12px] font-semibold text-[#111110]">▾ 🕒 Активность сегодня · {ACTS.length}</span>
          <div className="flex gap-1 flex-wrap">
            {['Все', '📞', '💬', '➡️', '📝', '⚙️'].map((l, i) => (
              <span key={i} className={`px-2 py-1 rounded-md text-[11px] ${i === 0 ? 'bg-[#111110] text-white' : 'bg-[#f0f0ec] text-[#6b6b66]'}`}>{l}</span>
            ))}
          </div>
        </div>
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {ACTS.map((ev, i) => (
            <div key={i} className="w-full text-left flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-[#f8f8f7]">
              <span className="text-[13px] shrink-0">{ev.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="text-[12px] text-[#111110]"><b>{ev.who}</b> <span className="text-[#6b6b66]">{ev.text}</span></span>
                <span className="block text-[10px] text-[#9a9a95]">{ev.time}{ev.author ? ` · ${ev.author}` : ''}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Воронка: зоны → этапы → карточки */}
      <div className="px-5 pt-4 space-y-5">
        {CRM_ZONES.map(z => {
          const zoneLeads = z.stages.reduce((s, st) => s + (byStage.get(st)?.length ?? 0), 0)
          return (
            <div key={z.zone}>
              <p className={`text-[11px] font-bold uppercase tracking-widest mb-2 ${z.tone}`}>{z.zone} · {zoneLeads}</p>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {z.stages.map(st => {
                  const list = byStage.get(st) ?? []
                  return (
                    <div key={st} className={`flex-shrink-0 w-60 rounded-xl border bg-white ${list.length ? 'border-[#e4e4e0]' : 'border-[#f0f0ec] opacity-60'}`}>
                      <p className="px-3 py-2 text-[11px] font-semibold text-[#6b6b66] border-b border-[#f8f8f7]">{st} · {list.length}</p>
                      <div className="p-2 space-y-2 min-h-[40px]">
                        {list.map(l => (
                          <div key={l.id} className={`w-full text-left rounded-lg border p-2.5 ${l.qualified ? 'border-amber-300 bg-amber-50/50' : 'border-[#eceff1]'}`}>
                            <p className="text-[12px] font-bold text-[#111110] truncate">
                              {l.qualified && '⭐ '}{l.name}{l.won && ' ✅'}{l.lost && ' ✖'}{l.overdue && <span title="Просроченная задача"> 🔴</span>}
                            </p>
                            <p className="text-[11px] text-[#6b6b66] truncate">{[l.product, l.sizes].filter(Boolean).join(' · ')}</p>
                            <p className="text-[10px] text-[#9a9a95] mt-0.5">{SRC[l.source]}{l.manager ? ` · ${l.manager}` : ''}{l.sum != null ? ` · ${RUB(l.sum)} ₽` : ''}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ===================== КАРТОЧКА ЛИДА ===================== */}
      <div className="mt-10 border-t-4 border-[#e4e4e0]">
        <div className="bg-[#f8f8f7] min-h-screen">
          <div className="max-w-[1200px] mx-auto px-4 py-5">
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span className="text-[13px] text-[#0071e3]">← Воронка</span>
              <h2 className="text-[18px] font-semibold text-[#111110]">⭐ {card.name}</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#f0f0ec] text-[#6b6b66]">{SRC[card.source]}</span>
            </div>

            {/* Путь по воронке */}
            <div className="mb-4 bg-white border border-[#e4e4e0] rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[12px] font-semibold text-[#111110] truncate">{card.stage}</span>
                <span className="text-[12px] font-bold text-emerald-600">30% <span className="text-[#9a9a95] font-normal">до «Успешно реализовано»</span></span>
              </div>
              <div className="h-1.5 rounded-full bg-[#f0f0ec] overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: '30%' }} /></div>
            </div>

            <div className="grid lg:grid-cols-[360px_1fr] gap-4">
              {/* Левая колонка — поля */}
              <div className="bg-white border border-[#e4e4e0] rounded-xl p-4 h-fit">
                {[['Номер заказа', '0157-3'], ['Имя', 'Сергей · дизайнер'], ['Телефон', '+7 (903) 214-88-50'], ['Город', 'Москва'], ['Адрес', 'ЖК «Прайм», корп. 2'], ['Продукт', 'Душевая перегородка'], ['Размеры', '900×2000 мм'], ['Бюджет', 'до 40к'], ['Предв.цена', '39 335 ₽']].map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2 py-1.5 border-b border-[#f0f0ec]">
                    <span className="text-[11px] text-[#9a9a95] w-[92px] shrink-0">{k}</span>
                    <span className="flex-1 text-[13px] text-[#111110]">{v}</span>
                  </div>
                ))}
                <button className="my-2 w-full px-3 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold">📞 Позвонить</button>
                <div className="flex gap-2 mt-2">
                  <button className="flex-1 px-2 py-2 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold">✅ Сделка</button>
                  <button className="flex-1 px-2 py-2 rounded-lg border border-red-200 text-red-600 text-[12px] font-semibold">✖ Отказ</button>
                </div>
              </div>

              {/* Правая колонка */}
              <div className="space-y-4">
                {/* Задачи */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-[#111110] mb-2">🗓 Задачи <span className="text-[11px] text-[#9a9a95] font-normal">— следующий шаг по клиенту</span></p>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] bg-[#f6f8ff]">
                    <span className="w-5 h-5 rounded-full border border-[#c4c4be] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[#111110] truncate">📐 Замер — согласовать день</p>
                      <p className="text-[10px] text-[#9a9a95]">завтра 12:00 · Семён</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    <input placeholder="Что сделать (позвонить, замер…)" className="w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                    <div className="flex gap-1.5">
                      <select className="border border-[#e4e4e0] rounded-lg px-2 py-2 text-[12px] bg-white"><option>🔔 Напоминание</option></select>
                      <input type="datetime-local" className="flex-1 min-w-0 border border-[#e4e4e0] rounded-lg px-2 py-2 text-[12px]" />
                      <button className="px-3 py-2 rounded-lg bg-[#111110] text-white text-[12px] font-semibold">＋</button>
                    </div>
                  </div>
                </div>

                {/* Переписка Авито */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[13px] font-semibold text-[#111110]">💬 Переписка с клиентом · Авито</p>
                    <span className="text-[10px] text-emerald-700">ведёте вы · Иван молчит</span>
                  </div>
                  <div className="bg-[#fafaf9] rounded-lg p-2 space-y-1.5">
                    {[['client', 'Здравствуйте! Нужна душевая перегородка 90×200, сколько выйдет?'], ['us', 'Здравствуйте! Такая душевая — примерно 39 335 ₽. Вы из Москвы?'], ['client', 'Да, Москва. Можно с замером?'], ['us', 'Конечно, согласуем удобный день. Подскажите телефон — менеджер свяжется.']].map(([from, text], i) => (
                      <div key={i} className={`flex ${from === 'us' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[80%] rounded-2xl px-3 py-1.5 text-[13px] ${from === 'us' ? 'bg-[#111110] text-white' : 'bg-white border border-[#e4e4e0] text-[#111110]'}`}>{text}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <input placeholder="Написать клиенту в Авито…" className="flex-1 border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] outline-none focus:border-[#111110]" />
                    <button className="px-4 py-2 rounded-lg bg-[#0071e3] text-white text-[13px] font-medium">Клиенту</button>
                  </div>
                </div>

                {/* Примечания и история */}
                <div className="bg-white border border-[#e4e4e0] rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-[#111110] mb-2">📝 Примечания и история <span className="text-[11px] text-[#9a9a95] font-normal">— клиент не видит</span></p>
                  <div className="space-y-1.5">
                    {[['bg-blue-50', '📞 Входящий звонок · +7 (903) 214-88-50 · 2:10', 'Семён · 16.07 16:12'], ['bg-[#eef5ff]', 'БОТ: Такая душевая — примерно 39 335 ₽', 'Иван (AI) · 16.07 15:50'], ['bg-[#f2f2f0]', 'КЛИЕНТ: Нужна душевая 90×200, сколько выйдет?', '16.07 15:49'], ['bg-[#fafaf9]', 'Этап: Проработка → Разговор состоялся', 'Семён · 16.07 16:12'], ['bg-amber-50', 'Клиент — дизайнер, будут повторные заказы', 'Семён · 16.07 16:15']].map(([tone, text, meta], i) => (
                      <div key={i} className={`text-[12px] rounded-lg px-3 py-1.5 ${tone}`}>
                        <p className="text-[#111110]">{text}</p>
                        <p className="text-[10px] text-[#9a9a95]">{meta}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
