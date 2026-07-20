import { ROADMAP, ROADMAP_UPDATED, type RoadmapStatus } from '@/lib/roadmapData'

// Доска прогресса работ для владельца: что сделано, что в работе, что в
// очереди и какие решения ждут его. Обновляется вместе с каждым PR.

const STATUS_META: Record<RoadmapStatus, { label: string; cls: string }> = {
  done:     { label: 'готово',       cls: 'bg-emerald-100 text-emerald-800' },
  progress: { label: 'в работе',     cls: 'bg-blue-100 text-blue-800' },
  queue:    { label: 'в очереди',    cls: 'bg-[#f0f0ec] text-[#6b6b66]' },
  waiting:  { label: 'ждёт решения', cls: 'bg-amber-100 text-amber-800' },
}

export default function ProgressPage() {
  const totalDone = ROADMAP.flatMap(s => s.items).filter(i => i.status === 'done').length
  const total = ROADMAP.flatMap(s => s.items).length

  return (
    <div className="min-h-screen bg-[#f5f5f3] px-4 py-6">
      <div className="max-w-[820px] mx-auto">
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-[22px] font-bold text-[#111110] tracking-tight">🗺 Прогресс работ</h1>
          <span className="text-[12px] text-[#9a9a95]">обновлено: {ROADMAP_UPDATED}</span>
        </div>
        <p className="text-[13px] text-[#6b6b66] mb-5">
          Выполнено {totalDone} из {total}. Доска обновляется с каждым выкатом: что отмечено «готово» — уже работает в проде.
        </p>

        <div className="space-y-4">
          {ROADMAP.map(section => {
            const done = section.items.filter(i => i.status === 'done').length
            const pct = Math.round(done / section.items.length * 100)
            return (
              <div key={section.title} className="bg-white rounded-xl border border-[#e4e4e0] overflow-hidden">
                <div className="px-4 pt-3.5 pb-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-[15px] font-semibold text-[#111110]">{section.icon} {section.title}</h2>
                    <span className="text-[12px] font-mono text-[#6b6b66]">{done}/{section.items.length}</span>
                  </div>
                  <div className="h-1.5 bg-[#f0f0ec] rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div>
                  {section.items.map(item => {
                    const m = STATUS_META[item.status]
                    return (
                      <div key={item.title} className="flex items-start justify-between gap-3 px-4 py-2.5 border-t border-[#f0f0ee]">
                        <div className="min-w-0">
                          <p className={`text-[13px] ${item.status === 'done' ? 'text-[#6b6b66]' : 'text-[#111110]'}`}>{item.title}</p>
                          {item.note && <p className="text-[12px] text-amber-700 mt-0.5">{item.note}</p>}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {item.date && <span className="text-[11px] text-[#9a9a95]">{item.date}</span>}
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${m.cls}`}>{m.label}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
