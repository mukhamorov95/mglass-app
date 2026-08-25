import Link from 'next/link'

// Каталог для партнёра (дизайн из прототипа, .pcab): что можно заказать у нас
// и перепродать своему клиенту. Никаких наших цен/себестоимости.

const CATALOG: { emoji: string; title: string; desc: string; margin: string; preset?: 'стекло' | 'зеркало' }[] = [
  { emoji: '💡', title: 'Зеркало с подсветкой (LED)', desc: 'В шкафы-купе, ванные, прихожие. Сенсор, диммер, подогрев. Готовое изделие «под ключ».', margin: 'ваша наценка 40–70%', preset: 'зеркало' },
  { emoji: '🚪', title: 'Лофт-перегородки', desc: 'Межкомнатные и зонирующие: чёрный профиль + закалённое стекло. Замер → изготовление → монтаж.', margin: 'ваша наценка 30–50%', preset: 'стекло' },
  { emoji: '🚿', title: 'Душевые перегородки и кабины', desc: 'Распашные, раздвижные, угловые. Закалка, фурнитура, монтаж.', margin: 'ваша наценка 30–50%', preset: 'стекло' },
  { emoji: '🪞', title: 'Резка стекла и зеркала под мебель', desc: 'Фартуки-скинали, фасады, полки, зеркала в двери. Партии любого объёма.', margin: 'объём → низкая цена за деталь', preset: 'стекло' },
  { emoji: '🎨', title: 'Пескоструй и матирование', desc: 'Полное матирование или рисунок по трафарету. Логотипы, декор.', margin: 'декор с высокой маржой', preset: 'стекло' },
  { emoji: '🔺', title: 'Обработка: закалка, кромка, фацет, сверловка', desc: 'Полный цикл в своём цехе. Короткий срок.', margin: '—', preset: 'стекло' },
]

export default function PartnerCatalogPage() {
  return (
    <>
      <div className="top">
        <div>
          <h1>Каталог</h1>
          <div className="cap">Закажите у нас — продайте своему клиенту дороже. Одно окно, короткий срок.</div>
        </div>
        <Link className="primary" href="/partner/new">＋ Просчёт</Link>
      </div>

      <div className="wrap">
        <div className="cat-grid">
          {CATALOG.map(p => (
            <div className="card" key={p.title} style={{ padding: 16, display: 'flex', flexDirection: 'column' }}>
              <p style={{ fontSize: 14, fontWeight: 700 }}>{p.emoji} {p.title}</p>
              <p style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 6, lineHeight: 1.5, flex: 1 }}>{p.desc}</p>
              {p.margin !== '—' && <p style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginTop: 8 }}>🎯 {p.margin}</p>}
              <Link className="ghost" href={`/partner/new?preset=${p.preset ?? 'стекло'}`} style={{ marginTop: 10, alignSelf: 'flex-start' }}>Посчитать →</Link>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 14, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700 }}>Посчитайте свой заказ прямо сейчас</p>
            <p className="cap" style={{ marginTop: 2 }}>Материал, размеры, обработка — цена сразу.</p>
          </div>
          <Link className="primary" href="/partner/new">＋ Новый просчёт</Link>
        </div>
      </div>
    </>
  )
}
