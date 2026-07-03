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

const DEFAULT_SECTIONS: KpSection[] = [
  { n: '1', title: 'Фиксированная стенка', desc: 'Осветлённое стекло Crystal Vision 8 мм, профиль П-образный.' },
  { n: '2', title: 'Распашная дверь', desc: 'Петля Dessau-103, магнитный притвор 90°, ручка-кноб DP-35.' },
  { n: '3', title: 'Боковая секция', desc: 'Уплотнители по контуру, держатели и штанга 15×15.' },
  { n: '✓', title: 'Фурнитура VETRO', desc: 'Цвет — золото брашированное: петли, держатели, заглушки.' },
]

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
  const sections = kp.sections && kp.sections.length ? kp.sections : DEFAULT_SECTIONS

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

        <Sec n="02" title="КЛЮЧЕВАЯ ХАРАКТЕРИСТИКА" meta="ГЕРМЕТИЧНОСТЬ" />
        <div className="kp-darkcard">
          <div className="left">
            <div className="big">{kp.key_stat ?? '80'}<span>{kp.key_stat_unit ?? '%'}</span></div>
            <div className="cap">{kp.key_stat_caption ?? 'ЗАЩИТА ОТ БРЫЗГ'}</div>
          </div>
          <div className="right">
            <div className="over">ЗАЩИТА ОТ БРЫЗГ · ГЕРМЕТИЧНОСТЬ КОНТУРА</div>
            <h2>{kp.key_headline ?? 'Душевое ограждение защищает от брызг и обеспечивает герметичность на 80%.'}</h2>
            <p>{kp.key_text ?? 'Точная геометрия по замеру, магнитный притвор 90° и уплотнители по всему контуру удерживают воду в зоне душа — сухой пол и чистый санузел.'}</p>
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
              ? <img src={kp.photo_url} alt="Схема" />
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

        <Sec n="08" title="ОФОРМЛЕНИЕ ЗАКАЗА" meta="СЛЕДУЮЩИЙ ШАГ" />
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
