// Shared types and constants — no server dependencies, safe for client components

export type B2BClientScope = 'mglass_only'

export type UserPermissions = {
  see_mglass:        boolean
  see_b2b:           boolean
  see_calendar:      boolean
  see_clients:       boolean
  see_earnings:      boolean
  b2b_client_scope?: B2BClientScope | null
}

export const DEFAULT_PERMISSIONS: UserPermissions = {
  see_mglass:        true,
  see_b2b:           true,
  see_calendar:      true,
  see_clients:       true,
  see_earnings:      true,
  b2b_client_scope:  null,
}
