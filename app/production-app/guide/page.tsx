import Link from 'next/link'
import ProductionTabs from '@/components/ProductionTabs'

// Регламент работы с программой — простая пошаговая инструкция для цеха.
// Статичная страница: кто куда нажимает, по ролям, на примере учебного заказа.

const LEGEND = [
  { c: 'bg-emerald-500', l: 'сделано' },
  { c: 'bg-blue-500',    l: 'в работе (видно кто)' },
  { c: 'bg-amber-400',   l: 'частично' },
  { c: 'bg-red-500',     l: 'проблема' },
  { c: 'bg-[#eceff1] border border-[#d7dee1]', l: 'не начато' },
]

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

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-4 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Регламент работы с программой</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Кто куда нажимает — по ролям. Читается за 5 минут.</p>
        <ProductionTabs />
      </div>

      <div className="px-4 pt-4 max-w-[720px] space-y-5">

        <div className="bg-amber-50 border-2 border-amber-300 rounded-xl px-4 py-3 text-[14px]">
          🎓 <b>В программе лежит учебный заказ «ДЕМО-1»</b> (клиент «УЧЕБНЫЙ»). На нём всё видно живьём:
          резка отмечена ✓, полировка «в работе» 🔧, остальное ждёт. Тренируйтесь на нём — его не жалко.
          <Link href="/production-app/demo"
            className="block mt-2.5 text-center bg-[#111110] text-white text-[14px] font-semibold py-2 rounded-lg hover:bg-[#2a2a28]">
            🎓 Открыть учебный заказ →
          </Link>
        </div>

        {/* Общий пул */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Заказы: общий пул на всех</h2>
            <Who color="bg-amber-600">общий пул</Who>
          </div>
          <Steps items={[
            <>Никто ничего не раздаёт вручную. Все заказы автоматически видны всем мастерам своей станции — бери любой.</>,
            <>Открой <Tab>Пул на сегодня</Tab>. Там все заказы цеха по станциям: «ДЕМО-1 · УЧЕБНЫЙ · 2 поз.» — одна карточка на заказ. Видно, что где стоит.</>,
            <>Открой <Tab>Обзор</Tab>: вид «По срокам» — что горит; вид «Матрица» — весь цех одной таблицей (заказ → этапы).
              <span className="flex gap-3 flex-wrap mt-2 text-[13px]">
                {LEGEND.map(x => <span key={x.l} className="flex items-center gap-1.5"><span className={`inline-block w-4 h-4 rounded ${x.c}`} />{x.l}</span>)}
              </span>
            </>,
          ]} />
        </div>

        {/* Мастер */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">День: сделал — отметь</h2>
            <Who color="bg-emerald-700">мастер</Who>
          </div>
          <Steps items={[
            <>Открой <Tab>Мои задачи</Tab>. Видишь заказы своей станции: «ДЕМО-1 · Поз. 1 · Полировка» с размерами детали — бери любой.
              <b> Готово к работе</b> — можно брать. <b>Ожидаю</b> — предыдущий этап ещё не сделан.</>,
            <>Взял деталь — нажми <Btn>Взял в работу</Btn>. Система сразу отметит на борде, что деталь у тебя.</>,
            <>Сделал — нажми <Btn tone="green">Готово</Btn>. Деталь сама уйдёт на следующий этап следующему человеку.</>,
            <>Что-то не так (скол, не тот размер, нет материала, станок встал) — нажми <Btn tone="red">Проблема</Btn> и выбери причину.
              Это не жалоба: система сразу подсветит проблему и поставит её на решение — так мы не теряем день.</>,
          ]} />
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 text-[14px]">
            ✂️ <b>Резчику удобнее через «Станции»:</b> открой <Tab>Станции → Резка</Tab> — детали уже собраны в партии
            по материалу и толщине («Прозрачное 8 мм — 5 листов»). Положил лист — раскроил детали из разных заказов —
            <Btn tone="green">Готово всё</Btn> одной кнопкой. У триплекса каждое стекло пакета — отдельная строка (слой 1: 8 мм, слой 2: 4 мм).
          </div>
        </div>

        {/* Купить */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Закончился расходник?</h2>
            <Who color="bg-[#2b5f86]">любой</Who>
          </div>
          <Steps items={[
            <>Открой <Tab>🛒 Купить</Tab> → <Btn>+ Новая заявка</Btn>. Напиши что нужно («Свёрла по стеклу 6 мм»), сколько, можно вставить ссылку на товар.</>,
            <>Заявка едет по доске: <b>Необходимо купить → Заказано → Приехал на склад</b>. Кто заказал и кто принял — видно с именем и временем.
              Внутри карточки можно обсуждать, где брать.</>,
          ]} />
        </div>

        {/* Идеи */}
        <div className="bg-white rounded-xl border border-[#e4e4e0] px-4 py-4">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="text-[17px] font-bold text-[#111110]">Есть идея или мешает проблема?</h2>
            <Who color="bg-[#2b5f86]">любой</Who>
          </div>
          <Steps items={[
            <>Открой <Tab>💡 Идеи</Tab> → нажми <Btn>🎤 Говорить</Btn> и просто расскажи голосом: что мешает и как, по-твоему, исправить. Или напиши текстом.</>,
            <>Нажми <Btn>Разобрать</Btn> — программа сама разложит на «Проблему» и «Твоё решение», поправь если надо — и <Btn tone="green">Отправить</Btn>.</>,
            <>Обращение попадает в список с твоим именем. Обсуждаем на планёрках <b>пн и пт</b>. <b>Если твою идею внедрили — получаешь премию.</b></>,
          ]} />
        </div>

        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-[14px]">
          ❗ <b>Одно правило, чтобы всё работало:</b> сделал — сразу отметь. Не отметил — для программы деталь «не готова»,
          следующий этап её «не видит», сроки едут. Отметка = 2 секунды.
        </div>

        <p className="text-[12px] text-[#9a9a95] pb-4">
          Где что лежит: меню слева → <b>Цех</b> (Обзор · Пул на сегодня · Станции · Мои задачи · Заказы в работе)
          · <b>Материал и документы</b> (Раскрой · Материал · Документы · Необходимо купить)
          · <b>Команда</b> (Идеи и проблемы) · <b>Обучение</b> (Регламент · Учебный заказ).
        </p>
      </div>
    </div>
  )
}
