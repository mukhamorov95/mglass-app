'use client'

// Печатная вёрстка КП (3 листа) — точная копия фирменного шаблона MGLASS.
// data-driven: читает готовую структуру content. Стр.1 динамическая (спецификация,
// смета, итоги), стр.2–3 — маркетинг-шаблон с переменными полями.

export type KpSpec = { label: string; value: string; accent?: boolean }
export type KpItem = { name: string; desc?: string; qty?: number | string; price?: number | string; sum?: number | string }
export type KpSection = { n: string; title: string; desc: string }

export type KpContent = {
  number?: string
  date?: string
  manager?: string
  valid_until?: string
  title?: string
  subtitle?: string
  total?: number | string
  spec?: KpSpec[]
  spec_note?: string
  vat_label?: string
  items?: KpItem[]
  subtotal?: number | string
  total_pay?: number | string
  vat_note?: string
  production_days?: string
  warranty?: string
  vat?: string
  photo_url?: string | null
  sections?: KpSection[]
  // маркетинг стр.2–3 (значения по умолчанию — фирменные)
  key_stat?: string        // «80»
  key_stat_unit?: string   // «%»
  key_stat_caption?: string
  key_headline?: string
  key_text?: string
}

const RUB = (v: number | string | undefined): string => {
  if (v === undefined || v === null || v === '') return '—'
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
  if (!isFinite(n)) return String(v)
  return n.toLocaleString('ru-RU')
}

// Тип изделия в КП по составу — чтобы «ключевая характеристика» на стр.2 и
// «схема комплектации» на стр.3 были релевантны (зеркалу — зеркальное, лофту — лофт).
type KpKind = 'shower' | 'mirror' | 'loft' | 'railing' | 'glass'

const DEFAULT_SECTIONS_BY_KIND: Record<KpKind, KpSection[]> = {
  shower: [
    { n: '1', title: 'Фиксированная стенка', desc: 'Осветлённое стекло Crystal Vision 8 мм, профиль П-образный.' },
    { n: '2', title: 'Распашная дверь', desc: 'Петля Dessau-103, магнитный притвор 90°, ручка-кноб DP-35.' },
    { n: '3', title: 'Боковая секция', desc: 'Уплотнители по контуру, держатели и штанга 15×15.' },
    { n: '✓', title: 'Фурнитура VETRO', desc: 'Цвет — золото брашированное: петли, держатели, заглушки.' },
  ],
  loft: [
    { n: '1', title: 'Несущий каркас', desc: 'Труба 40×20 мм, сварные соединения, порошковая покраска в любой цвет RAL.' },
    { n: '2', title: 'Створки', desc: 'Распашные или раздвижные двери — петли либо трек-система под конструктив.' },
    { n: '3', title: 'Стеклянные секции', desc: 'Закалённое стекло, штапик 15×15 с уплотнителем с двух сторон.' },
    { n: '✓', title: 'Фурнитура', desc: 'Ручки, петли, доводчики — в цвет каркаса.' },
  ],
  mirror: [
    { n: '1', title: 'Зеркальное полотно', desc: 'Влагостойкое серебряное покрытие, полированная кромка по контуру.' },
    { n: '2', title: 'Подсветка LED', desc: 'Лента по периметру, блок питания, сенсорная кнопка или датчик взмаха (опция).' },
    { n: '3', title: 'Крепление', desc: 'Скрытый каркас или подложка, надёжный монтаж на стену.' },
    { n: '✓', title: 'Металлическая рама', desc: 'Опция: сварная рама с порошковой покраской в любой цвет RAL.' },
  ],
  railing: [
    { n: '1', title: 'Стеклянные полотна', desc: 'Закалённое стекло 8–10 мм по ГОСТ, полированная кромка.' },
    { n: '2', title: 'Стойки и крепления', desc: 'Нержавеющая сталь, министойки или коннекторы — под ваш проект.' },
    { n: '3', title: 'Поручень', desc: 'По желанию: труба или профиль, металл либо дерево.' },
    { n: '✓', title: 'Монтаж', desc: 'Анкерное крепление с расчётом под нагрузку.' },
  ],
  glass: [
    { n: '1', title: 'Изделия по размерам', desc: 'Резка и обработка стекла и зеркал под ваш проект.' },
    { n: '2', title: 'Обработка кромки', desc: 'Полировка или еврокромка, фацет по желанию.' },
    { n: '3', title: 'Закалка', desc: 'Безопасное закалённое стекло по ГОСТ для нагруженных изделий.' },
    { n: '✓', title: 'Крепёж и монтаж', desc: 'Держатели, профили и установка на объекте.' },
  ],
}
function detectKpKind(items: KpItem[]): KpKind {
  const t = items.map(i => `${i.name} ${i.desc ?? ''}`).join(' ').toLowerCase()
  const has = (...kw: string[]) => kw.some(k => t.includes(k))
  if (has('душев')) return 'shower'
  if (has('лофт', 'перегородк')) return 'loft'
  if (has('огражд', 'лестни', 'перил', 'балкон')) return 'railing'
  if (has('зеркал')) return 'mirror'
  return 'glass'
}
const KP_KEY: Record<KpKind, { meta: string; stat: string; unit: string; caption: string; over: string; headline: string; text: string }> = {
  shower:  { meta: 'ГЕРМЕТИЧНОСТЬ', stat: '80', unit: '%', caption: 'ЗАЩИТА ОТ БРЫЗГ', over: 'ЗАЩИТА ОТ БРЫЗГ · ГЕРМЕТИЧНОСТЬ КОНТУРА', headline: 'Душевое ограждение защищает от брызг и обеспечивает герметичность на 80%.', text: 'Точная геометрия по замеру, магнитный притвор 90° и уплотнители по всему контуру удерживают воду в зоне душа — сухой пол и чистый санузел.' },
  mirror:  { meta: 'КАЧЕСТВО ЗЕРКАЛА', stat: '18', unit: 'мес', caption: 'ГАРАНТИЯ ПОКРЫТИЯ', over: 'РОВНОЕ ОТРАЖЕНИЕ · ВЛАГОСТОЙКОЕ СЕРЕБРО', headline: 'Зеркало с влагостойким серебряным покрытием и идеально ровным отражением.', text: 'Полированная кромка по контуру, скрытое крепление, по желанию — LED-подсветка и металлическая рама. Не мутнеет во влажном санузле, изготовление по вашим размерам.' },
  loft:    { meta: 'ПРОЧНОСТЬ', stat: '100', unit: '%', caption: 'ЗАКАЛЁННОЕ СТЕКЛО', over: 'ЗОНИРОВАНИЕ · СТИЛЬ ЛОФТ', headline: 'Лофт-перегородка из закалённого стекла в сварном металлическом каркасе.', text: 'Прочный каркас по вашему чертежу, порошковая покраска в любой RAL, распашные или раздвижные двери. Зонирует пространство и пропускает свет.' },
  railing: { meta: 'БЕЗОПАСНОСТЬ', stat: '100', unit: '%', caption: 'ЗАКАЛЁННОЕ СТЕКЛО', over: 'ПРОЧНОСТЬ · БЕЗОПАСНОЕ СТЕКЛО', headline: 'Стеклянное ограждение из закалённого стекла — безопасно и прозрачно.', text: 'Надёжное крепление, закалённое стекло по ГОСТ, полированная кромка. Ограждения для лестниц, балконов и террас без потери обзора.' },
  glass:   { meta: 'КАЧЕСТВО', stat: '100', unit: '%', caption: 'СВОЁ ПРОИЗВОДСТВО', over: 'КАЧЕСТВО · ЗАКАЛЁННОЕ СТЕКЛО', headline: 'Изделия из стекла по вашим размерам на собственном производстве.', text: 'Резка, закалка и обработка кромки под ваш проект. Точная геометрия по замеру, безопасное стекло по ГОСТ.' },
}

function Head() {
  return (
    <div className="kp-head">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/mglass-logo.png" alt="MGLASS" />
      <div className="kp-contacts">mglass.pro<br />8 (925) 788 58 37<br />mglass.ceo@gmail.com</div>
    </div>
  )
}

function Foot({ kp, page }: { kp: KpContent; page: number }) {
  return (
    <div className="kp-foot">
      <span className="b">MGLASS.PRO</span>
      <span className="m">КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ № {kp.number ?? '—'} · {kp.date ?? ''} · ЛИСТ {page} / 3</span>
    </div>
  )
}

function Sec({ n, title, meta }: { n: string; title: string; meta?: string }) {
  return (
    <div className="kp-sec">
      <span className="num">{n}</span>
      <span className="ttl">{title}</span>
      <span className="lead" />
      {meta && <span className="meta">{meta}</span>}
    </div>
  )
}

export default function KpDocument({ kp }: { kp: KpContent }) {
  const items = kp.items && kp.items.length ? kp.items : []
  const kind = detectKpKind(items)
  const kc = KP_KEY[kind]
  // Свои секции из редактора имеют приоритет; дефолт — по типу изделия
  const sections = kp.sections && kp.sections.length ? kp.sections : DEFAULT_SECTIONS_BY_KIND[kind]
  const CROSS = [
    { k: 'shower',  t: 'Душевые кабины', d: 'Ограждения и перегородки из закалённого стекла по замеру.' },
    { k: 'mirror',  t: 'Зеркала', d: 'С LED-подсветкой, в металлической раме — любой формы и размера.' },
    { k: 'loft',    t: 'Лофт-перегородки', d: 'Стекло в сварном каркасе, распашные и раздвижные двери.' },
    { k: 'railing', t: 'Стеклянные ограждения', d: 'Лестницы, балконы, террасы — прочно и прозрачно.' },
    { k: 'extra',   t: 'Стеклянные изделия', d: 'Полки, столешницы, козырьки, фартуки, столы.' },
  ].filter(c => c.k !== kind).slice(0, 4)

  return (
    <div className="kp-root">
      {/* ============ PAGE 1 ============ */}
      <div className="kp-page">
        <div className="kp-topbar" />
        <div className="kp-fit">
        <Head />

        <div className="kp-metabar">
          <div className="cell"><div className="k">КП №</div><div className="v red">{kp.number ?? '—'}</div></div>
          <div className="cell"><div className="k">ДАТА</div><div className="v">{kp.date ?? '—'}</div></div>
          <div className="cell"><div className="k">МЕНЕДЖЕР</div><div className="v">{kp.manager ?? '—'}</div></div>
          <div className="cell"><div className="k">АКТУАЛЬНО ДО</div><div className="v">{kp.valid_until ?? '—'}</div></div>
        </div>

        <Sec n="01" title="СМЕТА" meta={kp.vat_label ?? 'НДС 5% ВКЛЮЧЁН'} />
        <table className="kp-table">
          <thead><tr><th>№</th><th>НАИМЕНОВАНИЕ РАБОТ И МАТЕРИАЛОВ</th><th className="c">КОЛ-ВО</th><th className="r">ЦЕНА, ₽</th><th className="r">СУММА, ₽</th></tr></thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="n">{String(i + 1).padStart(2, '0')}</td>
                <td><div className="nm">{it.name}</div>{it.desc && <div className="ds">{it.desc}</div>}</td>
                <td className="qty">{it.qty ?? 1}</td>
                <td className="price">{RUB(it.price)}</td>
                <td className="sum">{RUB(it.sum)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="kp-subtotal"><span className="lbl">Промежуточный итог</span><span>{RUB(kp.subtotal ?? kp.total)} ₽</span></div>
        {(() => {
          // Скидка = разница между промежуточным итогом и итогом к оплате.
          // Показываем процент (целый, если ровный) и сумму — клиент видит выгоду.
          const toNum = (v?: number | string) => {
            if (v === undefined || v === null || v === '') return null
            const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.-]/g, ''))
            return isFinite(n) ? n : null
          }
          const sub = toNum(kp.subtotal ?? kp.total)
          const pay = toNum(kp.total_pay ?? kp.total)
          if (sub == null || pay == null || sub - pay < 1) return null
          const disc = sub - pay
          const pct = (disc / sub) * 100
          const pctLabel = Math.abs(pct - Math.round(pct)) < 0.05 ? String(Math.round(pct)) : pct.toFixed(1)
          return (
            <div className="kp-subtotal kp-discount">
              <span className="lbl">Ваша скидка {pctLabel}%</span>
              <span>− {RUB(disc)} ₽</span>
            </div>
          )
        })()}
        <div className="kp-paybar"><span className="l">ИТОГО К ОПЛАТЕ</span><span className="r">{RUB(kp.total_pay ?? kp.total)} ₽</span></div>
        {kp.vat_note && <div className="kp-vat">{kp.vat_note}</div>}

        <Foot kp={kp} page={1} />
        </div>
      </div>

      {/* ============ PAGE 2 ============ */}
      <div className="kp-page">
        <div className="kp-topbar" />
        <div className="kp-fit">
        <Head />

        <Sec n="02" title="КЛЮЧЕВАЯ ХАРАКТЕРИСТИКА" meta={kc.meta} />
        <div className="kp-darkcard">
          <div className="left">
            <div className="big">{kp.key_stat ?? kc.stat}<span>{kp.key_stat_unit ?? kc.unit}</span></div>
            <div className="cap">{kp.key_stat_caption ?? kc.caption}</div>
          </div>
          <div className="right">
            <div className="over">{kc.over}</div>
            <h2>{kp.key_headline ?? kc.headline}</h2>
            <p>{kp.key_text ?? kc.text}</p>
          </div>
        </div>

        <Sec n="03" title="ПОЛНЫЙ ЦИКЛ ПОД КЛЮЧ" meta="4 ЭТАПА" />
        <div className="kp-cards4">
          <div className="card"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 20h9M3 20l2-6 10-10 4 4L9 18l-6 2z" /></svg></div><h3>ЗАМЕР</h3><p>Выезд мастера, точные размеры проёма и геометрии на объекте.</p></div>
          <div className="card"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 21V9l6 4V9l6 4V5l6 4v12H3z" /></svg></div><h3>ИЗГОТОВЛЕНИЕ</h3><p>Резка, закалка и обработка стекла на собственном производстве.</p></div>
          <div className="card"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M1 6h13v9H1zM14 9h5l3 3v3h-8M5 18a2 2 0 100-4 2 2 0 000 4zM18 18a2 2 0 100-4 2 2 0 000 4z" /></svg></div><h3>ДОСТАВКА</h3><p>Бережная транспортировка изделия по адресу заказчика.</p></div>
          <div className="card"><div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M14 7l-2-2-8 8 2 2M14 7l4 4-6 6-4-4M14 7l3-3 3 3-3 3" /></svg></div><h3>МОНТАЖ</h3><p>Профессиональная установка и герметизация по контуру.</p></div>
        </div>

        <Sec n="04" title="ПОЧЕМУ MGLASS" meta="ГАРАНТИИ" />
        <div className="kp-why">
          <div className="item"><span className="n">01</span><div><h4>Собственное производство</h4><p>Контроль качества на каждом этапе — от раскроя до закалки стекла.</p></div></div>
          <div className="item"><span className="n">02</span><div><h4>Закалённое безопасное стекло</h4><p>Прочность и безопасность по ГОСТ, полированная кромка по контуру.</p></div></div>
          <div className="item"><span className="n">03</span><div><h4>Точный замер на объекте</h4><p>Изделие изготавливается под фактические размеры вашего санузла.</p></div></div>
          <div className="item"><span className="n">04</span><div><h4>Гарантия на изделие и монтаж</h4><p>Гарантийные обязательства на стекло, фурнитуру и монтажные работы.</p></div></div>
        </div>

        <Sec n="05" title="ЭТАПЫ РАБОТЫ" meta="ПОРЯДОК" />
        <div className="kp-stages">
          <div className="st"><div className="e">ЭТАП 01</div><h4>ЗАЯВКА И ЗАМЕР</h4><p>Согласуем визит, снимаем размеры, консультируем по стеклу и фурнитуре.</p></div>
          <div className="st"><div className="e">ЭТАП 02</div><h4>РАСЧЁТ И ДОГОВОР</h4><p>Финальная смета, спецификация изделия, договор и предоплата.</p></div>
          <div className="st"><div className="e">ЭТАП 03</div><h4>ИЗГОТОВЛЕНИЕ</h4><p>Производство изделия из стекла — {kp.production_days ?? '15 рабочих дней'}.</p></div>
          <div className="st"><div className="e">ЭТАП 04</div><h4>МОНТАЖ И СДАЧА</h4><p>Доставка, установка, герметизация и приёмка работ.</p></div>
        </div>

        <Sec n="06" title="УСЛОВИЯ" meta="СРОКИ" />
        <div className="kp-cond">
          <div className="c"><div className="k">СРОК ИЗГОТОВЛЕНИЯ</div><div className="v">{kp.production_days ?? '15 раб. дней'}</div></div>
          <div className="c"><div className="k">АКТУАЛЬНО ДО</div><div className="v">{kp.valid_until ?? '—'}</div></div>
          <div className="c"><div className="k">ГАРАНТИЯ</div><div className="v">{kp.warranty ?? 'Изделие + монтаж'}</div></div>
          <div className="c"><div className="k">НДС</div><div className="v">{kp.vat ?? '5% включён'}</div></div>
        </div>

        <Foot kp={kp} page={2} />
        </div>
      </div>

      {/* ============ PAGE 3 ============ */}
      <div className="kp-page">
        <div className="kp-topbar" />
        <div className="kp-fit">
        <Head />

        <Sec n="07" title="СХЕМА КОМПЛЕКТАЦИИ" meta="ЧЕРТЁЖ" />
        <div className="kp-schema">
          <div className="img">
            {kp.photo_url
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={kp.photo_url} alt="Схема" crossOrigin="anonymous" />
              : <div className="noimg">Фото / чертёж изделия</div>}
          </div>
          <div className="list">
            <div className="over">ОСНОВНЫЕ СЕКЦИИ</div>
            {sections.map((s, i) => (
              <div className="li" key={i}><span className="b">{s.n}</span><div><h4>{s.title}</h4><p>{s.desc}</p></div></div>
            ))}
          </div>
        </div>
        <div className="kp-note">Схема носит ознакомительный характер. Итоговая конфигурация и расположение элементов уточняются по результатам замера на объекте.</div>

        <Sec n="08" title="ЧТО ЕЩЁ МОЖНО ЗАКАЗАТЬ" meta="НАПРАВЛЕНИЯ" />
        <div className="kp-cards4">
          {CROSS.map((c, i) => (
            <div className="card" key={i}>
              <div className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></svg></div>
              <h3>{c.t}</h3><p>{c.d}</p>
            </div>
          ))}
        </div>

        <Sec n="09" title="ОФОРМЛЕНИЕ ЗАКАЗА" meta="СЛЕДУЮЩИЙ ШАГ" />
        <div className="kp-cta">
          <div><div className="over">ГОТОВЫ ПРИСТУПИТЬ</div><h2>СОГЛАСУЕМ ЗАМЕР<br />В УДОБНОЕ ВРЕМЯ</h2></div>
          <div className="r">8 (925) 788 58 37<br />mglass.ceo@gmail.com<br />mglass.pro</div>
        </div>
        <div className="kp-thanks">Благодарим за обращение в MGlass. Будем рады воплотить ваш проект.</div>

        <Foot kp={kp} page={3} />
        </div>
      </div>
    </div>
  )
}
