import type { ReactElement, ReactNode } from 'react'
import type { ShowerModelId } from '@/lib/showerCalculator'

type Props = { modelId: ShowerModelId; active: boolean }

// Единый иллюстрированный набор моделей душевых. Структура конфигураций взята с
// berusteklo (M1–M12), но отрисовка — своя: фронтальный вид, стекло с бликом,
// рамка/профиль, индикаторы двери (дуга распашной / стрелки раздвижной), для угловых —
// боковая возвратная панель в перспективе. Дизайн единый для всех 12.
export function ShowerModelIcon({ modelId, active }: Props): ReactElement {
  const glass  = active ? '#cfe6fb' : '#e9f1f8'   // стекло
  const gs     = active ? '#4a90d9' : '#aebfce'   // обводка стекла
  const fr      = active ? '#2b4a6b' : '#7b8a99'  // профиль/рамка
  const ac     = active ? '#2f6fd0' : '#a2b3c3'   // дуги/стрелки
  const hdl    = active ? '#3b6aa0' : '#9fadbb'   // ручка
  const wall   = active ? '#eef5fc' : '#f5f8fb'   // фон-стена
  const floor  = active ? '#dbe7f2' : '#e7edf3'   // пол

  // Стеклянная панель со стеклянным бликом.
  const Panel = (x: number, y: number, w: number, h: number, op = 1) => (
    <g key={`p${x}-${y}`}>
      <rect x={x} y={y} width={w} height={h} rx="1.5" fill={glass} fillOpacity={op} stroke={gs} strokeWidth="0.9" />
      <polygon points={`${x + 3},${y + 2} ${x + 7},${y + 2} ${x + 4.5},${y + h - 2} ${x + 0.5},${y + h - 2}`}
        fill="#ffffff" fillOpacity="0.5" />
    </g>
  )
  // Вертикальный профиль-разделитель.
  const Post = (x: number, y = 10, h = 50) => <rect key={`v${x}`} x={x} y={y} width="2.4" height={h} rx="1" fill={fr} />
  // Ручка.
  const Handle = (x: number, y = 32) => <rect key={`h${x}`} x={x} y={y} width="2.2" height="9" rx="1.1" fill={hdl} />
  // Дуга открывания распашной двери.
  const Arc = (d: string) => <path key={d} d={d} stroke={ac} strokeWidth="1.1" strokeDasharray="2.6,2" fill="none" strokeLinecap="round" />
  // Стрелка раздвижения.
  const Arrow = (cx: number, y: number, dir: 1 | -1) => (
    <g key={`a${cx}-${y}-${dir}`}>
      <line x1={cx - 6 * dir} y1={y} x2={cx + 5 * dir} y2={y} stroke={ac} strokeWidth="1.3" strokeLinecap="round" />
      <polygon points={`${cx + 5 * dir},${y - 2.4} ${cx + 8.5 * dir},${y} ${cx + 5 * dir},${y + 2.4}`} fill={ac} />
    </g>
  )
  // Верхняя штанга + нижний П-профиль прямой перегородки (x0..x1).
  const Rails = (x0: number, x1: number) => (
    <g key={`r${x0}`}>
      <rect x={x0} y="9.5" width={x1 - x0} height="2.6" rx="1" fill={fr} />
      <rect x={x0} y="60" width={x1 - x0} height="2.6" rx="1" fill={fr} />
      {Post(x0)}{Post(x1 - 2.4)}
    </g>
  )
  // Боковая возвратная панель для угловых (перспектива влево).
  const ReturnPanel = () => (
    <g key="ret">
      <polygon points="9,16 33,12 33,62 9,58" fill={glass} fillOpacity="0.72" stroke={gs} strokeWidth="0.9" />
      <polygon points="12,18 16,17.4 14,58 10,58.5" fill="#ffffff" fillOpacity="0.45" />
      <rect x="8" y="14" width="2.4" height="46" rx="1" fill={fr} />
      <rect x="31.4" y="11.5" width="2.6" height="51" rx="1.2" fill={fr} />
    </g>
  )

  const wrap = (children: ReactNode) => (
    <svg viewBox="0 0 100 74" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="100" height="74" rx="3" fill={wall} />
      <rect x="0" y="61" width="100" height="13" fill={floor} />
      {children}
    </svg>
  )

  // ─── Прямые модели: фронтальный вид, штора x=14..86 ───────────────────────
  const straight = (inner: ReactNode) => wrap(<>{Rails(14, 86)}{inner}</>)
  // ─── Угловые: возвратная панель слева + фронт x=34..86 ────────────────────
  const corner = (inner: ReactNode) => wrap(<>
    {ReturnPanel()}
    <rect x="34" y="9.5" width="52" height="2.6" rx="1" fill={fr} />
    <rect x="34" y="60" width="52" height="2.6" rx="1" fill={fr} />
    {Post(83.6)}
    {inner}
  </>)

  const icons: Record<ShowerModelId, ReactElement> = {
    // Стационарная панель
    M1: straight(<>{Panel(15, 12, 70, 48)}</>),
    // Неподвижное + распашная дверь (дверь справа)
    M2: straight(<>{Panel(15, 12, 33, 48, 0.82)}{Post(48)}{Panel(51, 12, 34, 48)}{Handle(81)}{Arc('M51,60 A34,48 0 0,0 84,14')}</>),
    // Распашная дверь + неподвижное (дверь слева)
    M3: straight(<>{Panel(15, 12, 34, 48)}{Handle(17)}{Arc('M49,60 A34,48 0 0,1 16,14')}{Post(49)}{Panel(52, 12, 33, 48, 0.82)}</>),
    // Угловая: 2 неподвижных + распашная дверь
    M4: corner(<>{Panel(35, 12, 22, 48, 0.82)}{Post(57)}{Panel(60, 12, 23, 48)}{Handle(79)}{Arc('M60,60 A23,48 0 0,0 82,14')}</>),
    // Только распашная дверь
    M5: straight(<>{Panel(15, 12, 70, 48)}{Handle(18)}{Arc('M85,60 A70,48 0 0,1 15,12')}</>),
    // Угловая: панель + дверь
    M6: corner(<>{Panel(35, 12, 26, 48, 0.82)}{Post(61)}{Panel(64, 12, 19, 48)}{Handle(79)}{Arc('M64,60 A19,48 0 0,0 82,14')}</>),
    // Угловая: 2 панели + дверь
    M7: corner(<>{Panel(35, 12, 18, 48, 0.82)}{Post(53)}{Panel(56, 12, 15, 48, 0.82)}{Post(71)}{Panel(73, 12, 10, 48)}{Handle(80)}{Arc('M73,60 A10,48 0 0,0 83,16')}</>),
    // Угловая: 2 раздвижных двери
    M8: corner(<>{Panel(35, 12, 26, 46, 0.7)}{Panel(48, 14, 26, 44)}{Arrow(60, 34, 1)}</>),
    // Угловая: раздвижная + 2 панели
    M9: corner(<>{Panel(35, 12, 16, 48, 0.82)}{Post(51)}{Panel(53, 12, 18, 46, 0.7)}{Panel(64, 14, 19, 44)}{Arrow(74, 34, 1)}</>),
    // Раздвижная прямая
    M10: straight(<>{Panel(15, 12, 40, 46, 0.68)}{Panel(45, 14, 40, 44)}{Arrow(32, 35, -1)}{Arrow(68, 35, 1)}</>),
    // Трапециевидная с дверью
    M11: straight(<>
      <polygon points="15,12 44,12 52,60 15,60" fill={glass} fillOpacity="0.82" stroke={gs} strokeWidth="0.9" />
      <polygon points="18,14 22,14 19,58 15.5,58" fill="#ffffff" fillOpacity="0.45" />
      <line x1="44" y1="12" x2="52" y2="60" stroke={fr} strokeWidth="2.6" />
      {Panel(55, 12, 30, 48)}{Handle(81)}{Arc('M55,60 A30,48 0 0,0 85,13')}
    </>),
    // Раздвижная (вариант): неподвижное + раздвижное
    M12: straight(<>{Panel(15, 12, 26, 48, 0.82)}{Post(41)}{Panel(44, 12, 22, 46, 0.68)}{Panel(60, 14, 25, 44)}{Arrow(72, 35, 1)}</>),
  }

  return (
    <div className="w-full h-full p-1 [&>svg]:w-full [&>svg]:h-full">
      {icons[modelId] ?? null}
    </div>
  )
}
