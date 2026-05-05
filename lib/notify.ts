// Sends email via Resend API. Requires RESEND_API_KEY + NOTIFY_ADMIN_EMAIL env vars.
// If either is missing, does nothing (graceful no-op).

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
