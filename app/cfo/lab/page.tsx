import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getRole } from '@/lib/getRole'
import { listProjects } from '@/lib/lab/store'
import { loadReferences } from '@/lib/lab/store'

// Лаборатория ценообразования: экспериментальные расчёты по ресурсной модели. Проекты
// лаборатории не заказы — в производство, на склад, в выручку и в статистику они не попадают.
export const dynamic = 'force-dynamic'

export default async function LabListPage() {
  const role = await getRole()
  if (role !== 'admin' && role !== 'ceo' && role !== 'cfo') redirect('/')

  const [{ rows, error }, refs] = await Promise.all([listProjects(), loadReferences()])

  return (
    <div className="min-h-screen bg-[#f5f5f3] p-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#111110]">Лаборатория ценообразования</h1>
            <p className="mt-1 text-sm text-[#9a9a95]">
              Себестоимость через физическое потребление ресурсов. Экспериментальный контур:
              действующий калькулятор, цены, прайсы и заказы не меняются.
            </p>
          </div>
          <Link href="/cfo/lab/new" className="shrink-0 rounded-md bg-[#111110] px-4 py-2 text-sm text-white">
            Новый расчёт
          </Link>
        </div>

        <div className="mt-4 rounded-lg border border-[#e4e4e0] bg-white p-4 text-xs">
          <div className="flex items-baseline justify-between gap-4">
            <p className="font-semibold text-[#111110]">Справочники</p>
            <Link href="/cfo/lab/reference" className="shrink-0 text-[#9a9a95] underline hover:text-[#111110]">
              Править нормативы →
            </Link>
          </div>
          <ul className="mt-1 space-y-0.5 text-[#9a9a95]">
            <li>Технические нормативы: {refs.source.tech ?? 'не загружены'}</li>
            <li>Финансовые параметры: {refs.source.finance ?? 'не загружены — деньги считаться не будут'}</li>
          </ul>
          {refs.problems.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-amber-700">
              {refs.problems.map(p => <li key={p}>• {p}</li>)}
            </ul>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
            Проекты не прочитались: {error}. Если таблиц лаборатории ещё нет, нужно применить
            миграцию <code>supabase/migrations/20261127_economics_lab.sql</code> — это согласуется отдельно.
          </p>
        )}

        <div className="mt-4 overflow-hidden rounded-lg border border-[#e4e4e0] bg-white">
          {rows.length === 0 && !error && (
            <p className="p-6 text-sm text-[#9a9a95]">Проектов пока нет. «Новый расчёт» — и первый появится.</p>
          )}
          {rows.map(r => (
            <Link key={r.id} href={`/cfo/lab/${r.id}`}
              className="flex items-baseline justify-between gap-4 border-b border-[#e4e4e0] px-4 py-3 last:border-0 hover:bg-[#f5f5f3]">
              <span className="text-sm text-[#111110]">{r.title}</span>
              <span className="text-xs text-[#9a9a95]">
                позиций {r.input?.positions?.length ?? 0} · вариантов {r.variants ?? 0} · изменён {r.updated_at.slice(0, 10)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
