import { ConfiguratorClient } from '@/components/configurator/ConfiguratorClient'
import { M_MODELS } from '@/lib/configurator/arrangement'

// Публичный встраиваемый виджет 3D-конфигуратора душевых. БЕЗ себестоимости —
// клиент собирает изделие, «Оставить заявку» шлёт конфигурацию в родительское
// окно (postMessage).
//
// ?model=М7 открывает сразу сборку этой модели: с сайта в 3D ведут карточки
// видов перегородок, и заставлять человека второй раз выбирать то, по чему он
// только что кликнул, — потерянный шаг.
export const metadata = { title: 'Конструктор душевой перегородки — M-Glass' }

export default async function EmbedShowerPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const { model } = await searchParams
  const initialModel = model && M_MODELS.some(m => m.code === model) ? model : undefined
  return <ConfiguratorClient variant="embed" initialModel={initialModel} />
}
