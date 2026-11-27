import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { listReferenceHistory, loadReferences } from '@/lib/lab/store'
import { referenceStamp } from '@/lib/economics/engine/reference'
import ReferenceClient from './ReferenceClient'

// Правка нормативов лаборатории. Экран нужен, чтобы норматив менялся решением владельца с
// причиной, а не новой версией файла. Доступ — владелец, CEO, CFO: в финансовом справочнике
// закупочные цены и ставки, выведенные из окладов.
export const dynamic = 'force-dynamic'

export default async function LabReferencePage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')

  const [refs, techHistory, financeHistory] = await Promise.all([
    loadReferences(),
    listReferenceHistory('tech'),
    listReferenceHistory('finance'),
  ])

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      {refs.problems.length > 0 && (
        <div className="mx-auto mb-4 max-w-6xl rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          <ul className="space-y-0.5">{refs.problems.map(p => <li key={p}>• {p}</li>)}</ul>
        </div>
      )}
      <ReferenceClient
        refs={{ tech: refs.tech, finance: refs.finance }}
        stamps={{
          tech: refs.tech ? referenceStamp(refs.tech) : null,
          finance: refs.finance ? referenceStamp(refs.finance) : null,
        }}
        source={refs.source}
        history={{ tech: techHistory, finance: financeHistory }}
      />
    </div>
  )
}
