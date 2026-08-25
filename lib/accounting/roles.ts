// Роли финансового контура, общие для всех роутов /api/accounting.
// Один список правится в одном месте: раньше был скопирован в десяти роутах.
import type { Role } from '@/lib/getRole'

// Кто видит и правит бухгалтерию: бухгалтеры + владельцы-финансы.
export const FIN_ROLES = ['accountant', 'cfo', 'admin', 'ceo'] as const satisfies readonly Role[]

// Кто может ОТКРЫТЬ закрытый месяц (закрыть — любой из FIN_ROLES).
// Бухгалтер закрыть может, распечатать замок — только владелец-финансы.
export const UNLOCK_ROLES = ['cfo', 'admin', 'ceo'] as const satisfies readonly Role[]
