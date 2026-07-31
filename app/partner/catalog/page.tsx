import Link from 'next/link'

// Каталог для партнёра: что можно заказать у нас и перепродать своему клиенту.
// Никаких наших цен/себестоимости — только предложение и призыв посчитать.

const CATALOG: { emoji: string; title: string; desc: string; margin: string }[] = [
  { emoji: '💡', title: 'Зеркало с подсветкой (LED)', desc: 'В шкафы-купе, ванные, прихожие. Сенсор, диммер, подогрев. Готовое изделие «под ключ».', margin: 'ваша наценка 40–70%' },
  { emoji: '🚪', title: 'Лофт-перегородки', desc: 'Межкомнатные и зонирующие: чёрный профиль + закалённое стекло. Замер → изготовление → монтаж.', margin: 'ваша наценка 30–50%' },
  { emoji: '🚿', title: 'Душевые перегородки и кабины', desc: 'Распашные, раздвижные, угловые. Закалка, фурнитура, монтаж.', margin: 'ваша наценка 30–50%' },
  { emoji: '🪞', title: 'Резка стекла и зеркала под мебель', desc: 'Фартуки-скинали, фасады, полки, зеркала в двери. Партии любого объёма.', margin: 'объём → низкая цена за деталь' },
  { emoji: '🎨', title: 'Пескоструй и матирование', desc: 'Полное матирование или рисунок по трафарету. Логотипы, декор.', margin: 'декор с высокой маржой' },
  { emoji: '🔺', title: 'Обработка: закалка, кромка, фацет, сверловка', desc: 'Полный цикл в своём цехе. Короткий срок.', margin: '—' },
]

export default function PartnerCatalogPage() {
  return (
    <div className="min-h-screen bg-[#f5f5f3] pb-20">
      <div className="bg-white border-b border-[#e4e4e0] px-4 pt-12 pb-3 lg:pt-6">
        <h1 className="text-[20px] font-bold text-[#111110] tracking-tight">Каталог</h1>
        <p className="text-[13px] text-[#9a9a95] mt-0.5">Закажите у нас — продайте своему клиенту дороже. Одно окно, короткий срок.</p>
      </div>

      <div className="px-4 pt-4 max-w-[760px] mx-auto space-y-2">
        <div className="grid sm:grid-cols-2 gap-2.5">
          {CATALOG.map(p => (
            <div key={p.title} className="bg-white border border-[#e4e4e0] rounded-xl p-4">
              <p className="text-[14px] font-semibold text-[#111110]">{p.emoji} {p.title}</p>
              <p className="text-[12px] text-[#6b6b66] mt-1 leading-relaxed">{p.desc}</p>
              {p.margin !== '—' && <p className="text-[11px] text-emerald-700 font-medium mt-2">🎯 {p.margin}</p>}
            </div>
          ))}
        </div>

        <div className="bg-[#111110] text-white rounded-xl p-4 flex items-center justify-between flex-wrap gap-2 mt-3">
          <div>
            <p className="text-[14px] font-semibold">Посчитайте свой заказ прямо сейчас</p>
            <p className="text-[12px] text-white/70 mt-0.5">Материал, размеры, обработка — цена сразу.</p>
          </div>
          <Link href="/partner/new" className="text-[12px] px-3 py-2 rounded-lg bg-white text-[#111110] font-semibold hover:bg-white/90 transition-colors">＋ Новый просчёт</Link>
        </div>
      </div>
    </div>
  )
}
