import type { Role } from '@/lib/getRole'

// Кто видит и нажимает «Отрезано» — те же роли, что и у остальных отметок цеха. Менеджер
// видит режим резчика (раскладку), но не отмечает.
export const CUT_MARK_ROLES: Role[] = ['production', 'admin', 'ceo', 'buyer']
