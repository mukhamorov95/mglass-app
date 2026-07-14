import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'

// Регламент работы цеха: за что отвечает каждая вкладка (в порядке нового меню —
// сверху то, чем мастер живёт каждый день) и пошаговая работа по ролям.

function Who({ color, children }: { color: string; children: React.ReactNode }) {
  return <span className={`text-[12px] font-bold text-white ${color} rounded-full px-3 py-0.5 whitespace-nowrap`}>{children}</span>
}
function Btn({ tone = 'dark', children }: { tone?: 'dark' | 'green' | 'red'; children: React.ReactNode }) {
  const cls = tone === 'green' ? 'bg-emerald-700' : tone === 'red' ? 'bg-red-600' : 'bg-[#16181a]'
  return <span className={`inline-block ${cls} text-white rounded-md px-2 py-px text-[13px] font-bold whitespace-nowrap`}>{children}</span>
}
function Tab({ children }: { children: React.ReactNode }) {
  return <span className="inline-block bg-[#eef1f2] border border-[#d7dee1] rounded-full px-2.5 py-px text-[13px] font-semibold whitespace-nowrap">{children}</span>
}
function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="mt-2">
      {items.map((it, i) => (
        <li key={i} className="grid grid-cols-[36px_1fr] gap-3 py-3 border-b border-[#eceff1] items-start">
          <span className="w-8 h-8 rounded-lg bg-[#16181a] text-white font-extrabold text-[15px] flex items-center justify-center mt-0.5">{i + 1}</span>
          <div className="text-[15px] leading-relaxed text-[#16181a]">{it}</div>
        </li>
      ))}
    </ol>
  )
}
function TabRow({ icon, name, who, children }: { icon: string; name: string; who: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[minmax(150px,175px)_1fr] gap-x-3 gap-y-1 py-2.5 border-b border-[#eceff1] items-start">
      <div>
        <div className="text-[14px] font-bold text-[#16181a] whitespace-nowrap">{icon} {name}</div>
        <div className="text-[11px] text-[#9a9a95] mt-0.5">{who}</div>
      </div>
      <div className="text-[14px] leading-relaxed text-[#4b4b47]">{children}</div>
    </div>
  )
}

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Регламент работы цеха</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Что где лежит и как работать — по вкладкам и по шагам. Читается за 5 минут.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-[720px] space-y-5">

        {/* Вкладки: за что отвечает каждая (порядок = порядок меню) */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <h2 className="text-[17px] font-bold text-[#111110]">Меню — за что отвечает каждая вкладка</h2>
          <p className="text-[13px] text-[#9a9a95] mt-0.5 mb-1.5">Порядок как в меню: сверху то, чем пользуются каждый день, ниже — экраны начальника и снабжения.</p>

          <TabRow icon="✅" name="Мои задачи" who="мастер — главный экран">
            Твоя личная очередь: что именно тебе резать / полировать / сверлить / калить / паковать — по срочности.
            Красное горит, жёлтое — срок близко. Кнопки: <Btn>Взял в работу</Btn>, <Btn tone="green">Готово</Btn>, <Btn tone="red">Проблема</Btn>,
            на весь заказ — <Btn tone="green">✅ Весь заказ готов</Btn> и <Btn tone="red">🛒 Нет материала</Btn> (на заказ целиком или на одну деталь — заявка в закупку уходит сама, остальное режется дальше).
            Переключатель <b>«По материалу и толщине»</b> собирает заказы в партии для резки (что кроить из одного листа), с фильтром Стекло / Зеркало.
          </TabRow>
          <TabRow icon="📋" name="Заказы" who="мастер, начальник">
            Все активные заказы по срочности. Открыл заказ — чертёж, детали и этапы кнопками.
            Здесь прикрепляют чертёж, печатают <b>наклейки и маршрутный лист</b>, жмут <Btn tone="green">📦 Упаковано — всё готово</Btn>, ставят «🔥 Срочно».
          </TabRow>
          <TabRow icon="📷" name="Скан" who="мастер — быстрая отметка">
            Навёл камеру или пикнул BT-сканером штрихкод наклейки — этап отмечен. Закрепи свою станцию — будет вообще без тапов.
          </TabRow>
          <TabRow icon="🔧" name="Заказы в работе" who="начальник">
            Список запущенных B2B-заказов со статусами — обзорный экран.
          </TabRow>
          <TabRow icon="🚚" name="Доставка в Воронеж" who="начальник, логист">
            Рейсы в Воронеж: создаёшь рейс к дате, набираешь заказы, видишь вес машины и кому что везём.
            <Btn>🖨 Лист рейса</Btn> — печатный список водителю с графами подписей.
          </TabRow>
          <TabRow icon="📈" name="Метрики цеха" who="начальник, владелец">
            Выработка цеха по дням и станциям.
          </TabRow>
          <TabRow icon="📦" name="Материал" who="Бекмурза, снабжение">
            Две вкладки. <b>«Проверка материала»</b> — новые заказы: «есть» / «нет» (резка не блокируется, мастер сам решает что резать).
            <b>«🛒 Нужен материал»</b> — сводка что докупить по материалу и толщине из всех отметок «нет материала»:
            если отмечен весь заказ — считаются все его стёкла, если одна деталь — только она; видно изделия, ≈м² и по каким заказам.
          </TabRow>
          <TabRow icon="✂️" name="Раскрой стекла" who="резчик">
            Оптимизация раскроя листов под детали заказов.
          </TabRow>
          <TabRow icon="🛒" name="Необходимо купить" who="любой">
            Заявки на закупку. Доска: <b>Необходимо купить → Заказано → Приехал на склад</b>. Можно наговорить голосом — программа сама заполнит заявку.
          </TabRow>
          <TabRow icon="📄" name="Документы" who="Валерия">
            Печать документов по заказам: что распечатано, что нет.
          </TabRow>
          <TabRow icon="💡" name="Идеи" who="любой">
            Заметил проблему — расскажи (можно голосом) и предложи решение. Обсуждаем на планёрках пн/пт. За внедрённые идеи — премия.
          </TabRow>
        </div>

        {/* День мастера */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Как работает мастер — по шагам</h2>
            <Who color="bg-emerald-700">мастер</Who>
          </div>
          <Steps items={[
            <>Пришёл — открыл <Tab>✅ Мои задачи</Tab>. Сверху самое срочное: красное — просрочка или «🔥 Срочно», у каждой задачи дата отгрузки и сколько дней осталось. <b>Готово к работе</b> — можно брать; <b>Ожидаю</b> — предыдущий этап ещё не сделан.</>,
            <>Берёшь верхнюю доступную задачу → жми <Btn>Взял в работу</Btn>. Все видят, что деталь у тебя — второй раз её никто не возьмёт.</>,
            <>Сделал — отметь сразу: быстрее всего <Tab>📷 Скан</Tab> (пикнул наклейку — этап закрылся), либо <Btn tone="green">Готово</Btn> в «Моих задачах». Деталь сама уйдёт на следующий этап следующему человеку.</>,
            <>Что-то не так (скол, брак, не тот размер, нет материала, станок встал) → <Btn tone="red">Проблема</Btn>, выбери причину, добавь пару слов. Начальник увидит сразу — не жди планёрки, не теряем день.</>,
            <>Заказ полностью собран и упакован → открой его в <Tab>📋 Заказы</Tab> и жми <Btn tone="green">📦 Упаковано — всё готово</Btn>. Заказ уходит в отгрузку.</>,
            <>Очередь пустая — возьми следующее из общего пула своей станции или спроси начальника. Конец дня с пустыми «Моими задачами» — день удался.</>,
          ]} />
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[14px]">
            ✂️ <b>Резчику удобнее через «Станции»:</b> открой <Tab>🏭 Станции → Резка</Tab> — детали собраны в партии
            по материалу и толщине («Прозрачное 8 мм — 5 листов»). Положил лист — раскроил детали из разных заказов —
            <Btn tone="green">Готово всё</Btn> одной кнопкой. У триплекса каждое стекло пакета — отдельная строка.
          </div>
        </div>

        {/* Наклейки */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Наклейки: паспорт детали</h2>
            <Who color="bg-slate-700">все этапы</Who>
          </div>
          <p className="text-[14px] text-[#16181a] mt-1.5">По наклейке сканируем этапы, по ней деталь после закалки находит себя, с ней изделие уезжает к заказчику.</p>
          <Steps items={[
            <><b>Резка.</b> Резчик печатает наклейки (<Tab>🖨 Наклейки</Tab> в карточке заказа) и клеит на деталь. <b>Плюс маркером</b> пишет на стекле размер и № заказа — единственное, что переживёт печь.</>,
            <><b>Обработка.</b> Полировка, сверловка, фацет — на каждом этапе сканируешь наклейку (<Tab>📷 Скан</Tab>), этап отмечается сам.</>,
            <><b>Перед закалкой — сними наклейку</b> (в печь она не идёт). Снятые клей на доску, сортируя по толщине — видно, что уехало в печь и что не вернулось. В печи деталь опознаётся по маркеру.</>,
            <><b>После закалки — верни наклейку</b>: по маркеру нашёл её на доске, приклеил обратно. Маркер стёр.</>,
            <><b>ОТК и упаковка.</b> Проверил → <Btn tone="green">Готово</Btn> на упаковке. Наклейка остаётся на изделии и едет к заказчику.</>,
          ]} />
        </div>

        {/* Начальник производства */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Начальник производства</h2>
            <Who color="bg-[#2b5f86]">начальник</Who>
          </div>
          <Steps items={[
            <>Утро: <Tab>📅 Пул на сегодня</Tab> — весь объём по станциям. Первым делом разрули красные проблемы мастеров.</>,
            <><Tab>🗓️ Обзор</Tab> — что горит по срокам. Горящему заказу ставь «🔥 Срочно» в карточке — у мастеров он взлетит наверх очереди.</>,
            <><Tab>🏭 Станции</Tab> — где завал, перекинь людей на узкое место.</>,
            <>Отгрузки: <Tab>🚚 Доставка в Воронеж</Tab> — создай рейс к дате, добирай готовые заказы, следи за весом машины (лимит и шкала в карточке рейса). Перед выездом — <Btn>🖨 Лист рейса</Btn> водителю, после выезда — <Btn tone="green">✓ Отправлена</Btn>.</>,
          ]} />
        </div>

        {/* Материал и документы */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Материал, закупки, документы</h2>
            <Who color="bg-amber-600">снабжение</Who>
          </div>
          <Steps items={[
            <><b>Материал (Бекмурза):</b> <Tab>📦 Материал</Tab> показывает новые заказы без проверки. Есть → <Btn tone="green">✅ Материал есть</Btn>, резка открыта. Нет → <Btn tone="red">🛒 Материала нет</Btn> — заявка на закупку создаётся сама, резка заблокирована. Пришёл → <Btn tone="green">✅ Материал пришёл</Btn>.</>,
            <><b>Расходники — любой:</b> <Tab>🛒 Купить</Tab> → <Btn>+ Новая заявка</Btn> или <Btn>🎤 Наговорить</Btn>. Заявка едет по доске, видно кто заказал и кто принял.</>,
            <><b>Документы (Валерия):</b> <Tab>📄 Документы</Tab> — печать по каждому заказу; наклейки и маршрутный лист — из карточки заказа в <Tab>📋 Заказы</Tab>.</>,
          ]} />
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[14px]">
          ❗ <b>Одно правило, чтобы всё работало:</b> сделал — сразу отметь. Не отметил — для программы деталь «не готова»,
          следующий этап её «не видит», сроки едут. Отметка = 2 секунды.
        </div>

        {/* Учебный заказ */}
        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-4 py-3 text-[14px]">
          🎓 <b>Тренируйся на учебном заказе «ДЕМО-1»</b> (клиент «УЧЕБНЫЙ») — там всё живьём:
          резка отмечена ✓, полировка в работе, остальное ждёт. Его не жалко.
          <Link href="/production-app/demo"
            className="block mt-2.5 text-center bg-[#111110] text-white text-[14px] font-semibold py-2 rounded-lg hover:bg-[#2a2a28]">
            🎓 Открыть учебный заказ →
          </Link>
        </div>

      </div>
    </div>
  )
}
