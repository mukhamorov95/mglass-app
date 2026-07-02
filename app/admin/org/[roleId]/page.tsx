import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getRoleById, LEVEL_LABELS } from '@/lib/roles-data'

export default async function RoleDetailPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params
  const role = getRoleById(roleId)
  if (!role) notFound()

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">

      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted mb-6">
        <Link href="/admin/org" className="hover:text-ink transition-colors">Оргструктура</Link>
        <span>/</span>
        <span className="text-ink">{role.title}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl"
            style={{ background: role.color + '18' }}
          >
            {role.emoji}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-ink">{role.title}</h1>
            <span className="text-sm text-ink-soft">{LEVEL_LABELS[role.level]}</span>
          </div>
        </div>
        <Link
          href={`/admin/org/${role.id}/print`}
          className="px-3 py-1.5 border border-line rounded-lg text-sm text-ink-soft hover:bg-canvas transition-colors"
        >
          PDF →
        </Link>
      </div>

      {/* Main goal */}
      <section className="mb-6 p-4 rounded-xl border-l-4 bg-canvas" style={{ borderColor: role.color }}>
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-1">Главная цель роли</p>
        <p className="text-sm text-ink leading-relaxed">{role.mainGoal}</p>
      </section>

      <section className="mb-6">
        <p className="text-xs font-semibold text-ink-soft uppercase tracking-wider mb-2">Продукт роли</p>
        <p className="text-sm text-ink-soft leading-relaxed bg-surface border border-line rounded-xl px-4 py-3">{role.product}</p>
      </section>

      {/* Responsibilities */}
      <Section title="Обязанности" color={role.color}>
        <ul className="space-y-1.5">
          {role.responsibilities.map((r, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
              <span className="text-muted mt-0.5">•</span>
              {r}
            </li>
          ))}
        </ul>
      </Section>

      {/* Daily Checks */}
      <Section title="Ежедневный чеклист" color={role.color}>
        <div className="space-y-1.5">
          {role.dailyChecks.map((c, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded border border-faint bg-surface flex-shrink-0 mt-0.5" />
              <span className="text-sm text-ink-soft">{c}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Functions */}
      <Section title="Функции (полный список)" color={role.color}>
        <div className="space-y-1.5">
          {role.functions.map((fn, i) => (
            <div key={fn.id} className="flex items-start gap-2.5">
              <div className="w-4 h-4 rounded border border-faint bg-surface flex-shrink-0 mt-0.5" />
              <span className="text-sm text-ink-soft">{fn.label}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* KPIs */}
      <Section title="KPI" color={role.color}>
        <div className="space-y-2">
          {role.kpis.map((kpi, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: role.color }} />
              <span className="text-sm text-ink-soft">{kpi}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Errors */}
      <Section title="Типичные ошибки" color="#dc2626">
        <ul className="space-y-1.5">
          {role.errors.map((e, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
              <span className="text-red-400 mt-0.5 flex-shrink-0">⚠</span>
              {e}
            </li>
          ))}
        </ul>
      </Section>

      {/* Prohibited */}
      <Section title="Запрещено" color="#dc2626">
        <ul className="space-y-1.5">
          {role.prohibited.map((p, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-ink-soft">
              <span className="text-red-500 mt-0.5 flex-shrink-0">✕</span>
              {p}
            </li>
          ))}
        </ul>
      </Section>

      {/* Tools */}
      <Section title="Инструменты" color={role.color}>
        <div className="flex flex-wrap gap-2">
          {role.tools.map((t, i) => (
            <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-line-soft text-ink-soft border border-line">
              {t}
            </span>
          ))}
        </div>
      </Section>

    </div>
  )
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-1 h-4 rounded-full" style={{ background: color }} />
        <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">{title}</h2>
      </div>
      <div className="pl-3">{children}</div>
    </section>
  )
}
