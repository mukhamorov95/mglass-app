// A11: провайдер-агностичный слой ЭДО (выгрузка УПД/актов оператору — Диадок/СБИС).
// Пока оператор не выбран, всё спит: edoEnabled() === false. Клиент скачивает УПД
// как PDF из кабинета. Когда владелец назовёт оператора — включаем через ENV
// EDO_PROVIDER + ключи и дописываем sendDocument(), не меняя генерацию документа.

export type EdoProvider = 'diadoc' | 'sbis'

export function edoEnabled(): boolean {
  return !!process.env.EDO_PROVIDER
}

export type EdoDocument = {
  orderId: number
  kind: 'upd'
  buyerInn: string | null
  // содержимое (позиции/суммы) провайдер формирует по своему формату из заказа
}

// Отправить документ контрагенту через оператора ЭДО. null → не подключено.
export async function sendDocument(_doc: EdoDocument): Promise<{ id: string } | null> {
  const provider = process.env.EDO_PROVIDER as EdoProvider | undefined
  if (!provider) return null
  // TODO(A11): интеграция с API оператора (Диадок/СБИС): аутентификация, формирование
  // XML УПД по формату ФНС, отправка контрагенту по ИНН, трекинг статуса подписания.
  return null
}
