import QuoterLoader from '../_components/QuoterLoader'

export const metadata = { title: 'Расчёт · GLASMEN демо' }

// ?source=dxf — сразу шаг «Форма: по чертежу DXF»; без параметра — деталь задаётся шагами.
export default async function GlasmenQuotePage({ searchParams }: { searchParams: Promise<{ source?: string | string[] }> }) {
  const { source } = await searchParams
  return <QuoterLoader initialSource={source === 'dxf' ? 'dxf' : source === 'form' ? 'form' : null} />
}
