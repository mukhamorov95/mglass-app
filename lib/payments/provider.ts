// A2: провайдер-агностичный слой онлайн-оплаты. Пока эквайринг не выбран, всё
// это спит: paymentsEnabled() === false, кнопка «Оплатить онлайн» в кабинете скрыта.
// Когда владелец назовёт провайдера — включаем через ENV PAYMENT_PROVIDER и ключи,
// и дописываем адаптер (createYooKassaLink / createTinkoffLink) без изменения UI/эндпоинтов.

export type PaymentProvider = 'yookassa' | 'tinkoff'

export function paymentsEnabled(): boolean {
  return !!process.env.PAYMENT_PROVIDER
}

export type CreateLinkInput = {
  orderId: number
  amount: number            // рубли, к оплате
  description: string
  returnUrl: string         // куда вернуть клиента после оплаты
}

// Возвращает URL платёжной страницы провайдера или null, если оплата не подключена.
export async function createPaymentLink(input: CreateLinkInput): Promise<{ url: string } | null> {
  const provider = process.env.PAYMENT_PROVIDER as PaymentProvider | undefined
  if (!provider) return null
  switch (provider) {
    case 'yookassa': return createYooKassaLink(input)
    case 'tinkoff':  return createTinkoffLink(input)
    default:         return null
  }
}

// ── Адаптеры (заглушки до подключения ключей) ───────────────────────────────
// Реализуются, когда владелец даст ключи. Контракт: вернуть { url } или бросить —
// эндпоинт /pay обработает null как «не настроено».

async function createYooKassaLink(_input: CreateLinkInput): Promise<{ url: string } | null> {
  // TODO(A2): YOOKASSA_SHOP_ID + YOOKASSA_SECRET_KEY → POST https://api.yookassa.ru/v3/payments
  //   { amount, confirmation: { type: 'redirect', return_url }, metadata: { orderId } }
  //   вернуть confirmation.confirmation_url. Оплата подтверждается вебхуком (см. /api/payments/webhook).
  return null
}

async function createTinkoffLink(_input: CreateLinkInput): Promise<{ url: string } | null> {
  // TODO(A2): TINKOFF_TERMINAL_KEY + TINKOFF_PASSWORD → Init API, вернуть PaymentURL.
  return null
}

// Проверка подписи вебхука провайдера (реализуется вместе с адаптером).
export function verifyWebhook(_provider: PaymentProvider, _headers: Headers, _rawBody: string): boolean {
  // TODO(A2): проверка подписи по секрету провайдера. Пока провайдера нет — не доверяем.
  return false
}
