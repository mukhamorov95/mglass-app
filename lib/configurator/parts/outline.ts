// Контур вида сверху для примитива extrude: дуги чертежа → ломаная, мм.

export type P2 = [number, number]

const r2 = (v: number) => Math.round(v * 100) / 100

// Дуга окружности с центром c и радиусом r от угла a0 до a1 (градусы, в осях самого контура),
// шаг по дуге — около step мм. Концы входят в результат.
export function arc(c: P2, r: number, a0: number, a1: number, step = 1): P2[] {
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * Math.PI * r) / 180 / step))
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180
    return [r2(c[0] + r * Math.cos(a)), r2(c[1] + r * Math.sin(a))]
  })
}

// Угол точки окружности по её первой координате (на той половине, где вторая больше центра).
export const angleAt = (c: P2, r: number, x: number) => (Math.acos((x - c[0]) / r) * 180) / Math.PI
