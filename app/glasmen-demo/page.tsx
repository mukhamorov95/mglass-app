import Link from 'next/link'
import MaterialsGrid from './_components/MaterialsGrid'

const CTA = 'Загрузить чертёж или задать размеры — увидеть цену'

const OPERATIONS = [
  { t: 'Резка', d: 'Прямоугольники, круги, овалы, арки и любой контур из DXF.' },
  { t: 'Кромка', d: 'Шлифовка и полировка торца по всему периметру детали.' },
  { t: 'Сверление', d: 'Отверстия под петли, держатели и крепёж — до закалки.' },
  { t: 'Вырезы', d: 'Под розетки, выключатели, ручки — со скруглёнными углами.' },
  { t: 'Закалка', d: 'Закалённое стекло для душевых, полок, ограждений.' },
  { t: 'Фацет', d: 'Декоративная скошенная кромка по периметру.' },
  { t: 'Триплекс', d: 'Склейка двух-трёх стёкол плёнкой. В расчёте демо пока нет.' },
  { t: 'Зеркала', d: 'Серебро и тонированные; зеркало не закаливается.' },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Как получить цену без менеджера?',
    a: 'Загрузите DXF или пройдите шаги: стекло или зеркало, толщина, материал, размеры, количество. Цену считает код по нашему действующему прайсу — за штуку и за партию, сразу на экране.',
  },
  {
    q: 'Какие файлы принимаете?',
    a: 'DXF в текстовом виде (ASCII, R12 и новее), в миллиметрах или дюймах — после загрузки вы подтверждаете единицы. Двоичный DXF не читается. PDF, DWG и фото — пока нет.',
  },
  {
    q: 'Нет чертежа — что делать?',
    a: 'Задайте ширину и высоту, при необходимости — форму (скруглённые углы, скос, круг, овал, арка), отверстия и вырезы. Получившуюся деталь можно скачать как DXF.',
  },
  {
    q: 'Можно ли сверлить и резать закалённое стекло?',
    a: 'Нет. Все отверстия и вырезы делаются до закалки, поэтому их нужно задать в чертеже сразу. Калькулятор проверяет их расстояния до кромки, углов и друг до друга.',
  },
  {
    q: 'Что входит в цену, а что доплата?',
    a: 'В цену за м² входят закалка, кромка, сверление и вырезы. Отдельно — фацет и триплекс. К большим габаритам и криволинейной форме прибавляется надбавка в процентах — калькулятор показывает её строкой.',
  },
  {
    q: 'Есть ли минимальный заказ?',
    a: 'Сейчас есть минимальная цена позиции, минимальной суммы заказа нет. Вводить ли минимум заказа и какой — ждёт решения владельца.',
  },
  {
    q: 'Как работает скидка за количество?',
    a: 'Сейчас цена за штуку от количества не зависит. Варианты лесенки за тираж посчитаны в демо для сравнения — это черновик, ждёт решения владельца.',
  },
  {
    q: 'Когда будет готово?',
    a: 'Ждёт замера сроков по базе заказов. Обещать дату до замера не будем.',
  },
]

export default function GlasmenDemoHome() {
  return (
    <div className="space-y-12">
      <section className="rounded-2xl border border-[#e4e4e0] bg-white px-5 py-8 sm:px-8 sm:py-12">
        <p className="text-[12px] font-medium uppercase tracking-wide text-[#9a9a95]">Стекло и зеркала под размер для бизнеса</p>
        <h1 className="mt-2 max-w-3xl text-[26px] font-semibold leading-tight tracking-tight sm:text-[36px]">
          Цена стеклянной детали за секунды — по чертежу или размерам
        </h1>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#55554f] sm:text-[15px]">
          Загрузите DXF — калькулятор найдёт контур, отверстия и вырезы, проверит их по правилам стекла и покажет цену за штуку и за партию. Без звонка и без регистрации — так задумано для будущего сайта; демо открыто только владельцу.
        </p>
        <Link
          href="/glasmen-demo/quote"
          className="mt-6 inline-flex max-w-full items-center justify-center rounded-xl bg-[#111110] px-5 py-3 text-center text-[14px] font-medium text-white hover:bg-black"
        >
          {CTA}
        </Link>
        <p className="mt-3 text-[12px] text-[#9a9a95]">Второе действие на сайте — «Получить счёт на юрлицо»; в демо не работает.</p>
      </section>

      <section>
        <h2 className="text-[18px] font-semibold tracking-tight">Что режем и обрабатываем</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {OPERATIONS.map(o => (
            <div key={o.t} className="rounded-xl border border-[#e4e4e0] bg-white p-3">
              <div className="text-[14px] font-medium">{o.t}</div>
              <div className="mt-1 text-[12px] leading-snug text-[#55554f]">{o.d}</div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[#9a9a95]">Срок каждой операции («+N дней») — после замера по базе.</p>
      </section>

      <section className="rounded-2xl border border-[#e4e4e0] bg-white p-5 sm:p-6">
        <h2 className="text-[18px] font-semibold tracking-tight">Как считается цена</h2>
        <ol className="mt-3 space-y-2 text-[14px] leading-relaxed text-[#33332f]">
          <li><b>Прайс за м² × площадь детали по габариту.</b> Прайс — наш действующий, по материалу и толщине, вкл. НДС 22 %.</li>
          <li><b>Включено в цену за м²:</b> закалка, кромка, сверление, вырезы.</li>
          <li><b>Отдельно:</b> фацет (за погонный метр периметра) и триплекс (в расчёте демо пока нет).</li>
          <li><b>Надбавки</b> процентом к цене — за большой габарит и криволинейную форму.</li>
          <li><b>Минимальная цена позиции</b> — у мелкой детали цена не опускается ниже неё; калькулятор отмечает это строкой.</li>
          <li>
            <b>Лесенка за тираж — варианты, черновик.</b> Сейчас цена за штуку от количества не зависит. В расчёте рядом показаны четыре варианта
            (наладка на строку или на заказ × материал, лесенка за серию, минимальный заказ) — для решения 4.
          </li>
        </ol>
        <Link href="/glasmen-demo/quote" className="mt-4 inline-block text-[13px] font-medium underline underline-offset-2 hover:no-underline">
          Посмотреть на своей детали →
        </Link>
      </section>

      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[18px] font-semibold tracking-tight">Материалы</h2>
          <Link href="/glasmen-demo/materials" className="text-[13px] underline underline-offset-2 hover:no-underline">Все материалы и правила →</Link>
        </div>
        <div className="mt-3"><MaterialsGrid /></div>
      </section>

      <section>
        <h2 className="text-[18px] font-semibold tracking-tight">Нет чертежа? По шагам или фото</h2>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Link href="/glasmen-demo/quote?source=form" className="rounded-xl border border-[#e4e4e0] bg-white p-4 hover:border-[#111110]">
            <div className="text-[14px] font-medium">По шагам</div>
            <div className="mt-1 text-[12px] leading-snug text-[#55554f]">Стекло или зеркало → толщина → материал → размеры → количество → форма, отверстия и вырезы. DXF скачивается.</div>
          </Link>
          <Link href="/glasmen-demo/quote?source=dxf" className="rounded-xl border border-[#e4e4e0] bg-white p-4 hover:border-[#111110]">
            <div className="text-[14px] font-medium">По чертежу DXF</div>
            <div className="mt-1 text-[12px] leading-snug text-[#55554f]">Размеры, форма, отверстия и вырезы — из файла; проверка по правилам стекла.</div>
          </Link>
          <div className="rounded-xl border border-dashed border-[#e4e4e0] bg-white/60 p-4">
            <div className="text-[14px] font-medium text-[#55554f]">Фото или эскиз <span className="ml-1 rounded bg-[#f5f5f3] px-1.5 py-0.5 text-[11px] font-normal text-[#9a9a95]">скоро</span></div>
            <div className="mt-1 text-[12px] leading-snug text-[#9a9a95]">ИИ найдёт размеры, вы подтвердите, цену посчитает тот же код.</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-dashed border-[#e4e4e0] bg-white/60 p-5">
        <h2 className="text-[18px] font-semibold tracking-tight">Сроки</h2>
        <p className="mt-2 text-[14px] text-[#55554f]">Ждёт замера по базе: от оплаты до «готово к отгрузке» — отдельно без закалки, с закалкой, с фацетом или триплексом. До замера дату не показываем.</p>
      </section>

      <section>
        <h2 className="text-[18px] font-semibold tracking-tight">Частые вопросы</h2>
        <div className="mt-3 divide-y divide-[#e4e4e0] rounded-2xl border border-[#e4e4e0] bg-white">
          {FAQ.map(f => (
            <details key={f.q} className="group px-4 py-3">
              <summary className="cursor-pointer list-none text-[14px] font-medium marker:hidden">
                <span className="mr-2 inline-block text-[#9a9a95] transition group-open:rotate-90">›</span>{f.q}
              </summary>
              <p className="mt-2 pl-4 text-[13px] leading-relaxed text-[#55554f]">{f.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
