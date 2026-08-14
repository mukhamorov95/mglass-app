// Юрлица заказчика (b2b_client_legal_entities). У одного B2B-клиента может быть
// несколько плательщиков; реквизиты добавляются не затирая старые, при счёте
// выбирается одно. Общие типы/поля/хелперы для CRM-карточки и страницы счёта.

export type B2BLegalEntity = {
  id: number
  client_id: number
  organization_id: number
  full_name: string | null
  inn: string | null
  kpp: string | null
  ogrn: string | null
  legal_address: string | null
  bank_account: string | null
  bank_name: string | null
  bik: string | null
  corr_account: string | null
  supply_contract_no: string | null
  supply_contract_date: string | null
  is_default: boolean
  active: boolean
  created_at?: string
}

export type EntityForm = {
  full_name: string; inn: string; kpp: string; ogrn: string; legal_address: string
  bank_account: string; bank_name: string; bik: string; corr_account: string
  supply_contract_no: string; supply_contract_date: string
}

// Поля формы юрлица (порядок = отрисовка). Плоские колонки b2b_clients — те же имена.
export const ENTITY_FIELDS: { key: keyof EntityForm; label: string; wide?: boolean; type?: 'date' }[] = [
  { key: 'full_name', label: 'Полное юр. наименование', wide: true },
  { key: 'inn', label: 'ИНН' },
  { key: 'kpp', label: 'КПП' },
  { key: 'ogrn', label: 'ОГРН / ОГРНИП' },
  { key: 'legal_address', label: 'Юридический адрес', wide: true },
  { key: 'bank_name', label: 'Банк' },
  { key: 'bank_account', label: 'Р/С' },
  { key: 'bik', label: 'БИК' },
  { key: 'corr_account', label: 'К/С' },
  { key: 'supply_contract_no', label: 'Договор поставки №' },
  { key: 'supply_contract_date', label: 'Дата договора', type: 'date' },
]

// Плоские колонки-зеркало в b2b_clients (совместимость с пакетным счётом/старым кодом).
export const CLIENT_MIRROR_FIELDS = ENTITY_FIELDS.map(f => f.key)

export const emptyEntityForm = (): EntityForm =>
  Object.fromEntries(ENTITY_FIELDS.map(f => [f.key, ''])) as EntityForm

export function entityToForm(e: Partial<B2BLegalEntity> | null | undefined): EntityForm {
  const f = emptyEntityForm()
  if (!e) return f
  for (const { key } of ENTITY_FIELDS) f[key] = (e[key] as string | null | undefined) ?? ''
  return f
}

// Форма → строка для insert/update: пустые → null.
export function formToRow(f: EntityForm): Record<string, string | null> {
  return Object.fromEntries(ENTITY_FIELDS.map(({ key }) => [key, f[key].trim() || null]))
}

// Заголовок юрлица для списка/селектора.
export function entityTitle(e: Pick<B2BLegalEntity, 'full_name' | 'inn'>): string {
  return (e.full_name && e.full_name.trim()) || (e.inn ? `ИНН ${e.inn}` : 'Юрлицо без названия')
}
