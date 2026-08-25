import { NextResponse } from 'next/server'
import { getRole, getSessionUser, type Role } from '@/lib/getRole'

// Кто видит склад: владелец, снабжение, производство, продажи и финансы.
export const INVENTORY_READ_ROLES: Role[] = [
  'admin', 'ceo', 'buyer', 'production', 'manager', 'commercial', 'cfo',
]

// Кто двигает остатки: владелец, снабжение, производство. Продажи — только смотрят.
export const INVENTORY_WRITE_ROLES: Role[] = ['admin', 'ceo', 'buyer', 'production']

// Себестоимость и стоимость запасов — только владелец, снабжение и финансы.
export const INVENTORY_COST_ROLES: Role[] = ['admin', 'ceo', 'buyer', 'cfo']

function forbidden() {
  return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 })
}

export type InventoryActor = { role: Role; userId: string; name: string; canSeeCost: boolean }

async function actor(allowed: Role[]): Promise<InventoryActor | NextResponse> {
  const role = await getRole()
  if (!role || !allowed.includes(role)) return forbidden()
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })
  return {
    role,
    userId:     user.id,
    name:       (user.user_metadata?.name as string | undefined) ?? user.email ?? '',
    canSeeCost: INVENTORY_COST_ROLES.includes(role),
  }
}

export const requireInventoryRead  = () => actor(INVENTORY_READ_ROLES)
export const requireInventoryWrite = () => actor(INVENTORY_WRITE_ROLES)
