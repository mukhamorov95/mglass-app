import type { ReactElement } from 'react'
import type { ShowerModelId } from '@/lib/showerCalculator'

type Props = { modelId: ShowerModelId; active: boolean }

export function ShowerModelIcon({ modelId, active }: Props) {
  const fr  = active ? '#1e293b' : '#475569'  // профиль
  const bg  = active ? '#dbeafe' : '#f1f5f9'  // фон (стена)
  const gf  = active ? '#e0f2fe' : '#f8fafc'  // стекло
  const gs  = active ? '#0369a1' : '#94a3b8'  // обводка стекла
  const ac  = active ? '#2563eb' : '#94a3b8'  // дуга / стрелки
  const wl  = active ? '#bfdbfe' : '#e2e8f0'  // цвет стены (план)

  // ── стекло с тонким бликом ────────────────────────────────────────────
  const G = (x: number, y: number, w: number, h: number, op = 0.85) => (
    <>
      <rect x={x} y={y} width={w} height={h}
        fill={gf} fillOpacity={op} stroke={gs} strokeWidth="1"/>
      <line x1={x+3} y1={y+3} x2={x+3} y2={y+h-3}
        stroke="white" strokeWidth="2" strokeOpacity="0.7"/>
    </>
  )

  // профиль-разделитель (вертикальный)
  const Div = (x: number) =>
    <rect x={x} y={0} width={3} height={60} fill={fr}/>

  // ручка на двери
  const Hdl = (x: number, y = 28) =>
    <rect x={x} y={y} width={2} height={10} fill={fr} rx="1"/>

  // дуга открывания (от точки петли)
  const Arc = (d: string) =>
    <path d={d} stroke={ac} strokeWidth="1.2" strokeDasharray="3,2" fill="none" strokeOpacity="0.8"/>

  // стрелка раздвижения
  const Arr = (x1: number, y: number, dir: 'l' | 'r') => (
    dir === 'r'
      ? <><line x1={x1} y1={y} x2={x1+7} y2={y} stroke={ac} strokeWidth="1.5"/>
          <polygon points={`${x1+7},${y-2} ${x1+11},${y} ${x1+7},${y+2}`} fill={ac}/></>
      : <><line x1={x1} y1={y} x2={x1-7} y2={y} stroke={ac} strokeWidth="1.5"/>
          <polygon points={`${x1-7},${y-2} ${x1-11},${y} ${x1-7},${y+2}`} fill={ac}/></>
  )

  const icons: Record<ShowerModelId, ReactElement> = {

    // ═══ ПРЯМЫЕ — фасадный вид, viewBox 0 0 80 60 ════════════════════
    // фон-стена: x=0..80 y=0..60; профиль: 3px; стекло: y=3..57

    M1: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>     {/* штанга сверху */}
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>   {/* лев. профиль */}
        <rect x="77" y="0" width="3" height="60" fill={fr}/>   {/* прав. профиль */}
        <rect x="0" y="57" width="80" height="3" fill={fr}/>   {/* П-профиль снизу */}
        {G(3, 3, 74, 54)}
      </svg>
    ),

    M2: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {Div(39)}
        {G(3, 3, 36, 54, 0.75)}   {/* неподвижное */}
        {G(42, 3, 35, 54)}         {/* распашная дверь */}
        {Hdl(74, 27)}
        {Arc('M42,57 A35,35 0 0,0 77,22')}
      </svg>
    ),

    M3: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {Div(38)}
        {G(3, 3, 35, 54)}           {/* распашная дверь */}
        {Hdl(5, 27)}
        {Arc('M38,57 A35,35 0 0,1 3,22')}
        {G(41, 3, 36, 54, 0.75)}   {/* неподвижное */}
      </svg>
    ),

    M5: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {G(3, 3, 74, 54)}
        {Hdl(5, 27)}
        {Arc('M77,57 A74,54 0 0,1 3,3')}
      </svg>
    ),

    M10: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {G(30, 6, 47, 48, 0.7)}   {/* заднее */}
        {G(3, 3, 47, 54)}          {/* переднее */}
        {Arr(18, 30, 'l')}
        {Arr(62, 30, 'r')}
      </svg>
    ),

    M11: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {/* неподвижная трапеция */}
        <polygon points="3,3 40,3 50,57 3,57"
          fill={gf} fillOpacity="0.8" stroke={gs} strokeWidth="1"/>
        <line x1="6" y1="5" x2="6" y2="55" stroke="white" strokeWidth="2" strokeOpacity="0.6"/>
        {/* диагональный профиль */}
        <line x1="40" y1="3" x2="50" y2="57" stroke={fr} strokeWidth="3.5"/>
        {/* дверь */}
        <polygon points="44,3 77,3 77,57 54,57"
          fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1"/>
        <line x1="47" y1="5" x2="47" y2="55" stroke="white" strokeWidth="2" strokeOpacity="0.6"/>
        {Hdl(74, 27)}
        {Arc('M44,57 A36,44 0 0,0 77,13')}
      </svg>
    ),

    M12: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={bg}/>
        <rect x="0" y="0" width="80" height="3" fill={fr}/>
        <rect x="0" y="0" width="3"  height="60" fill={fr}/>
        <rect x="77" y="0" width="3" height="60" fill={fr}/>
        <rect x="0" y="57" width="80" height="3" fill={fr}/>
        {Div(26)}
        {G(3, 3, 23, 54, 0.75)}   {/* неподвижное */}
        {G(47, 6, 30, 48, 0.7)}   {/* заднее раздвижное */}
        {G(29, 3, 32, 54)}         {/* переднее раздвижное */}
        {Arr(52, 30, 'r')}
      </svg>
    ),

    // ═══ УГЛОВЫЕ — план сверху, viewBox 0 0 80 60 ════════════════════
    // стены: верхняя полоса y=0..8 и левая x=0..8

    M4: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={wl}/>
        {/* стены */}
        <rect x="0" y="0" width="80" height="8" fill={fr}/>
        <rect x="0" y="0" width="8"  height="60" fill={fr}/>
        {/* неподвижное на верхней стене */}
        <rect x="8" y="8" width="5" height="26" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {/* дверь */}
        <rect x="22" y="8" width="5" height="26" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {Arc('M22,34 A26,26 0 0,0 48,8')}
        {/* неподвижное на левой стене */}
        <rect x="8" y="8" width="26" height="5" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {/* неподвижное 2 на верхней стене */}
        <rect x="50" y="8" width="5" height="20" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
      </svg>
    ),

    M6: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={wl}/>
        <rect x="0" y="0" width="80" height="8" fill={fr}/>
        <rect x="0" y="0" width="8"  height="60" fill={fr}/>
        {/* панель на левой стене */}
        <rect x="8" y="10" width="30" height="5" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {/* дверь на верхней стене */}
        <rect x="16" y="8" width="5" height="28" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {Arc('M16,36 A28,28 0 0,0 44,8')}
      </svg>
    ),

    M7: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={wl}/>
        <rect x="0" y="0" width="80" height="8" fill={fr}/>
        <rect x="0" y="0" width="8"  height="60" fill={fr}/>
        {/* панель 1 на левой стене */}
        <rect x="8" y="10" width="34" height="5" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {/* дверь */}
        <rect x="18" y="8" width="5" height="30" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {Arc('M18,38 A30,30 0 0,0 48,8')}
        {/* панель 2 на верхней стене */}
        <rect x="52" y="8" width="5" height="22" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
      </svg>
    ),

    M8: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={wl}/>
        <rect x="0" y="0" width="80" height="8" fill={fr}/>
        <rect x="0" y="0" width="8"  height="60" fill={fr}/>
        {/* раздвижная 1 на верхней стене */}
        <rect x="8"  y="8"  width="5" height="30" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        <rect x="14" y="8"  width="5" height="26" fill={gf} fillOpacity="0.6" stroke={gs} strokeWidth="1"/>
        <line x1="10.5" y1="22" x2="10.5" y2="14" stroke={ac} strokeWidth="1.3"/>
        <polygon points="9,14 10.5,10 12,14" fill={ac}/>
        {/* раздвижная 2 на левой стене */}
        <rect x="8"  y="10" width="30" height="5" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        <rect x="8"  y="16" width="26" height="5" fill={gf} fillOpacity="0.6" stroke={gs} strokeWidth="1"/>
        <line x1="22" y1="12.5" x2="14" y2="12.5" stroke={ac} strokeWidth="1.3"/>
        <polygon points="14,11 10,12.5 14,14" fill={ac}/>
      </svg>
    ),

    M9: (
      <svg viewBox="0 0 80 60" fill="none">
        <rect width="80" height="60" fill={wl}/>
        <rect x="0" y="0" width="80" height="8" fill={fr}/>
        <rect x="0" y="0" width="8"  height="60" fill={fr}/>
        {/* панель 1 на верхней стене */}
        <rect x="8" y="8" width="5" height="20" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        {/* раздвижная на верхней стене */}
        <rect x="18" y="8" width="5" height="28" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
        <rect x="24" y="8" width="5" height="24" fill={gf} fillOpacity="0.6" stroke={gs} strokeWidth="1"/>
        <line x1="20.5" y1="22" x2="20.5" y2="14" stroke={ac} strokeWidth="1.3"/>
        <polygon points="19,14 20.5,10 22,14" fill={ac}/>
        {/* панель 2 на левой стене */}
        <rect x="8" y="10" width="24" height="5" fill={gf} fillOpacity="0.9" stroke={gs} strokeWidth="1.2"/>
      </svg>
    ),

  }

  return (
    <div className="w-full h-16">
      {icons[modelId] ?? null}
    </div>
  )
}
