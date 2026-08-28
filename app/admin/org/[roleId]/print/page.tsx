import { notFound } from 'next/navigation'
import { getRoleById, LEVEL_LABELS } from '@/lib/roles-data'
import { PrintButton } from '@/app/admin/route-sheet/PrintButton'

export default async function RolePrintPage({ params }: { params: Promise<{ roleId: string }> }) {
  const { roleId } = await params
  const role = getRoleById(roleId)
  if (!role) notFound()

  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <>
      <style>{`
        @page { margin: 18mm 14mm; size: A4; }
        @media print {
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
        }
        * { box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, sans-serif; background: #fff; }
      `}</style>

      <div className="no-print fixed top-4 right-4 z-50">
        <PrintButton />
      </div>

      <div className="max-w-[700px] mx-auto px-8 py-10 text-[#111110]">

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24, paddingBottom: 14, borderBottom: '2px solid #111110' }}>
          <div>
            <p style={{ fontSize: 10, color: '#9a9a95', textTransform: 'uppercase', letterSpacing: 1, margin: '0 0 2px' }}>MGlass — Регламент роли</p>
            <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>{role.emoji} {role.title}</h1>
            <p style={{ fontSize: 12, color: '#6b6b66', margin: 0 }}>{LEVEL_LABELS[role.level]}</p>
          </div>
          <p style={{ fontSize: 12, color: '#9a9a95', margin: 0, textAlign: 'right' }}>
            {today}
          </p>
        </div>

        {/* Main goal */}
        <div style={{ background: '#f8f8f7', borderLeft: `4px solid ${role.color}`, borderRadius: 8, padding: '12px 14px', marginBottom: 20 }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a95', margin: '0 0 4px' }}>Главная цель роли</p>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{role.mainGoal}</p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a95', margin: '0 0 4px' }}>Продукт роли</p>
          <p style={{ fontSize: 12, margin: 0, color: '#4b4b47', lineHeight: 1.5 }}>{role.product}</p>
        </div>

        {/* Two column layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <PrintSection title="Обязанности" color={role.color}>
            {role.responsibilities.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#9a9a95', flexShrink: 0 }}>•</span>
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{r}</span>
              </div>
            ))}
          </PrintSection>

          <PrintSection title="KPI" color={role.color}>
            {role.kpis.map((kpi, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'flex-start' }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: role.color, flexShrink: 0, marginTop: 4 }} />
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{kpi}</span>
              </div>
            ))}
          </PrintSection>
        </div>

        {/* Daily Checklist */}
        <PrintSection title="Ежедневный чеклист" color={role.color}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            {role.dailyChecks.map((c, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ width: 12, height: 12, border: '1px solid #d1d5db', borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{c}</span>
              </div>
            ))}
          </div>
        </PrintSection>

        {/* Functions */}
        <PrintSection title="Функции (полный список)" color={role.color}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
            {role.functions.map(fn => (
              <div key={fn.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 4 }}>
                <div style={{ width: 12, height: 12, border: '1px solid #d1d5db', borderRadius: 2, flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{fn.label}</span>
              </div>
            ))}
          </div>
        </PrintSection>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          {/* Errors */}
          <PrintSection title="Типичные ошибки" color="#dc2626">
            {role.errors.map((e, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#dc2626', flexShrink: 0, fontSize: 11 }}>⚠</span>
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{e}</span>
              </div>
            ))}
          </PrintSection>

          {/* Prohibited */}
          <PrintSection title="Запрещено" color="#dc2626">
            {role.prohibited.map((p, i) => (
              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <span style={{ color: '#dc2626', flexShrink: 0, fontSize: 11 }}>✕</span>
                <span style={{ fontSize: 11, color: '#4b4b47', lineHeight: 1.4 }}>{p}</span>
              </div>
            ))}
          </PrintSection>
        </div>

        {/* Tools */}
        <PrintSection title="Инструменты" color={role.color}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {role.tools.map((t, i) => (
              <span key={i} style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, border: '1px solid #e4e4e0', background: '#f8f8f7', color: '#4b4b47' }}>
                {t}
              </span>
            ))}
          </div>
        </PrintSection>

        {/* Signature */}
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid #e4e4e0', display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9a9a95' }}>
          <span>MGlass — Регламент роли: {role.title}</span>
          <span>{today}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
          <div style={{ borderTop: '1px solid #111110', width: '45%', paddingTop: 4, fontSize: 11, color: '#6b6b66' }}>
            Подпись сотрудника: ___________________
          </div>
          <div style={{ borderTop: '1px solid #111110', width: '45%', paddingTop: 4, fontSize: 11, color: '#6b6b66' }}>
            Дата ознакомления: ____________________
          </div>
        </div>

      </div>
    </>
  )
}

function PrintSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 3, height: 14, borderRadius: 2, background: color, flexShrink: 0 }} />
        <p style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#9a9a95', margin: 0 }}>{title}</p>
      </div>
      {children}
    </div>
  )
}
