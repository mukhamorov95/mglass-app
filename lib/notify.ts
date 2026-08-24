// Sends email via Resend API. Requires RESEND_API_KEY (+ NOTIFY_ADMIN_EMAIL for admin mail).
// If the key is missing, everything here is a graceful no-op — почта опциональна.

const FROM = 'M-Glass <noreply@mglass.ru>'

// Общая обёртка над Resend. Возвращает true, если письмо реально отправлено.
export async function sendEmail(params: { to: string; subject: string; html: string }): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey || !params.to) return false
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ from: FROM, to: [params.to], subject: params.subject, html: params.html }),
    })
    return r.ok
  } catch { return false }
}

// Единый премиальный каркас письма для партнёра (без внешних картинок — inline-стили).
function partnerShell(inner: string, cta?: { href: string; label: string }): string {
  const button = cta
    ? `<a href="${cta.href}" style="display:inline-block;margin-top:18px;padding:11px 22px;background:#111110;color:#fff;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">${cta.label} →</a>`
    : ''
  return `
  <div style="background:#f0f0ec;padding:28px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e4e0;border-radius:16px;overflow:hidden">
      <div style="padding:22px 26px 0"><span style="font-size:17px;font-weight:800;letter-spacing:.02em;color:#111110">M‑GLASS</span>
        <span style="font-size:12px;color:#9a9a95;margin-left:8px">Кабинет заказчика</span></div>
      <div style="padding:16px 26px 26px;color:#111110;font-size:14px;line-height:1.55">
        ${inner}
        ${button}
      </div>
      <div style="padding:14px 26px;border-top:1px solid #f0f0ec;color:#9a9a95;font-size:11.5px">
        Это письмо отправлено автоматически из кабинета заказчика M‑Glass.
      </div>
    </div>
  </div>`
}

// Приглашение в кабинет: ссылка на установку пароля.
export async function notifyPartnerAccessGranted(params: { to: string; clientName: string; setupLink: string }): Promise<boolean> {
  return sendEmail({
    to: params.to,
    subject: 'Доступ в кабинет заказчика M-Glass',
    html: partnerShell(
      `<p style="margin:0 0 10px"><b>${params.clientName}</b>, вам открыт доступ в личный кабинет заказчика M‑Glass.</p>
       <p style="margin:0;color:#3a3a38">Задайте свой пароль по кнопке ниже — его будете знать только вы.
       Внутри: расчёт по вашим договорным ценам, отправка заказов в работу и статус производства.</p>
       <p style="margin:12px 0 0;color:#9a9a95;font-size:12.5px">Ссылка одноразовая и действует 7 дней.</p>`,
      { href: params.setupLink, label: 'Установить пароль' },
    ),
  })
}

// Смена статуса заказа: принят в работу / готов к выдаче / отгружен.
export async function notifyPartnerOrderStatus(params: {
  to: string; clientName: string; orderNumber: string; kind: 'in_work' | 'ready' | 'shipped'; link: string
}): Promise<boolean> {
  const map = {
    in_work: { s: `Заказ ${params.orderNumber} принят в работу`, t: 'Мы запустили ваш заказ в производство. Следить за готовностью можно в кабинете.' },
    ready:   { s: `Заказ ${params.orderNumber} готов к выдаче`,   t: 'Ваш заказ изготовлен и готов к выдаче. Менеджер согласует с вами отгрузку.' },
    shipped: { s: `Заказ ${params.orderNumber} отгружен`,         t: 'Ваш заказ отгружен. Спасибо, что работаете с M‑Glass.' },
  }[params.kind]
  return sendEmail({
    to: params.to,
    subject: `[M-Glass] ${map.s}`,
    html: partnerShell(
      `<p style="margin:0 0 10px"><b>${params.clientName}</b>, ${map.s.toLowerCase()}.</p>
       <p style="margin:0;color:#3a3a38">${map.t}</p>`,
      { href: params.link, label: 'Открыть заказ' },
    ),
  })
}

export async function notifyApprovalRequired(params: {
  orderNumber: string
  clientName: string
  marginPercent: number
  orderId: string
}) {
  const apiKey    = process.env.RESEND_API_KEY
  const adminEmail = process.env.NOTIFY_ADMIN_EMAIL
  if (!apiKey || !adminEmail) return

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from:    'MGlass <noreply@mglass.ru>',
      to:      [adminEmail],
      subject: `[MGlass] Заказ ${params.orderNumber} ожидает одобрения`,
      html: `
        <p>Новый заказ требует вашего одобрения из-за низкой маржи.</p>
        <table style="margin:16px 0;border-collapse:collapse">
          <tr><td style="padding:4px 12px 4px 0;color:#6b6b66;font-size:13px">Заказ</td><td style="font-weight:600;font-size:13px">${params.orderNumber}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b6b66;font-size:13px">Клиент</td><td style="font-size:13px">${params.clientName}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#6b6b66;font-size:13px">Маржа</td><td style="font-size:13px;color:#dc2626">${params.marginPercent.toFixed(1)}%</td></tr>
        </table>
        <a href="${appUrl}/orders/${params.orderId}"
          style="display:inline-block;padding:10px 20px;background:#111110;color:white;text-decoration:none;border-radius:8px;font-size:13px;font-weight:600">
          Открыть заказ →
        </a>
      `,
    }),
  }).catch(() => { /* silent — notification failure must not affect order creation */ })
}
