import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { createServiceClient } from '@/lib/supabase-service'
import { getProject, listVariants, loadReferences } from '@/lib/lab/store'
import { DEFAULT_SCENARIO, emptyPosition, type LabProject } from '@/lib/economics/lab/project'
import type { B2BMaterial } from '@/lib/types'
import LabClient from '../LabClient'

export const dynamic = 'force-dynamic'

export default async function LabProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')
  const { id } = await params
  const isNew = id === 'new'

  const sb = createServiceClient()
  const [{ data: matRows }, refs, row] = await Promise.all([
    sb.from('b2b_materials').select('id, name, category, thickness, active').eq('active', true).order('category').order('thickness'),
    loadReferences(),
    isNew ? Promise.resolve(null) : getProject(id),
  ])
  if (!isNew && !row) redirect('/cfo/lab')
  const variants = isNew ? [] : await listVariants(id)

  const project: LabProject = row
    ? { ...row.input, id: row.id, title: row.title, note: row.note }
    : { title: 'Новый расчёт', note: '', scenario: { ...DEFAULT_SCENARIO }, overrides: [], positions: [emptyPosition('p1')] }

  const materials = ((matRows ?? []) as Pick<B2BMaterial, 'id' | 'name' | 'category' | 'thickness'>[])
    .map(m => ({ id: m.id, name: m.name, category: m.category, thickness: m.thickness }))

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="mx-auto max-w-6xl">
        <Link href="/cfo/lab" className="text-xs text-[#9a9a95] hover:text-[#111110]">← Лаборатория</Link>
        <LabClient
          initial={project}
          materials={materials}
          variants={variants.map(v => ({
            id: v.id, label: v.label, note: v.note, computedAt: v.computed_at,
            techStamp: v.tech_stamp, financeStamp: v.finance_stamp, input: v.input,
          }))}
          refSource={refs.source}
          refProblems={refs.problems}
        />
      </div>
    </div>
  )
}
