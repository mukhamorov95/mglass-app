import { ConfiguratorClient } from '@/components/configurator/ConfiguratorClient'

// Публичный встраиваемый виджет 3D-конфигуратора душевых для сайта mglass.pro (Tilda).
// БЕЗ себестоимости — клиент собирает изделие, «Оставить заявку» шлёт конфигурацию
// в родительское окно (postMessage), Tilda передаёт её в CRM.
export const metadata = { title: 'Конструктор душевой перегородки — M-Glass' }

export default function EmbedShowerPage() {
  return <ConfiguratorClient variant="embed" />
}
