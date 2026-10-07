import type { Role } from '@/lib/getRole'

// Кто записывает оплату счёта вручную: финконтур реестра счетов (как в /api/invoices).
export const INVOICE_PAY_ROLES = ['admin', 'ceo', 'cfo', 'accountant', 'commercial'] as const satisfies readonly Role[]

// Кто видит долг клиентов целиком (/ceo, /cfo/receivables, прогноз кассы).
export const RECEIVABLES_ROLES = ['admin', 'ceo', 'cfo', 'accountant'] as const satisfies readonly Role[]
