'use client'

import { createContext, useContext, useEffect, useState, useRef, ReactNode, createElement } from 'react'

export type OrgRole = 'admin' | 'manager'

interface OrgContextValue {
  orgId: number
  role: OrgRole
  loading: boolean
}

const OrgContext = createContext<OrgContextValue>({ orgId: 1, role: 'manager', loading: false })

interface OrganizationProviderProps {
  children: ReactNode
  // Server-seeded values eliminate the loading state for SSR-rendered pages
  initialOrgId?: number
  initialRole?: OrgRole
}

export function OrganizationProvider({ children, initialOrgId, initialRole }: OrganizationProviderProps) {
  const [orgId, setOrgId]   = useState<number>(initialOrgId ?? 1)
  const [role, setRole]     = useState<OrgRole>(initialRole ?? 'manager')
  const [loading, setLoading] = useState(!initialOrgId)
  const fetched = useRef(false)

  useEffect(() => {
    if (initialOrgId || fetched.current) return
    fetched.current = true

    fetch('/api/auth/setup-org')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.orgId) {
          setOrgId(data.orgId)
          setRole(data.role ?? 'manager')
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [initialOrgId])

  return createElement(OrgContext.Provider, { value: { orgId, role, loading } }, children)
}

// Primary hook — use this everywhere you need org context
export function useOrganization(): OrgContextValue {
  return useContext(OrgContext)
}
