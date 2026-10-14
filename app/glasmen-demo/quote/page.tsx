import QuoterLoader from '../_components/QuoterLoader'
import type { Tab } from '../_components/quoterState'

export const metadata = { title: 'Расчёт · GLASMEN демо' }

const TABS: Tab[] = ['dxf', 'template', 'size']

export default async function GlasmenQuotePage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const { tab } = await searchParams
  const t = typeof tab === 'string' && (TABS as string[]).includes(tab) ? (tab as Tab) : null
  return <QuoterLoader initialTab={t} />
}
