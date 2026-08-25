'use client'

import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { BALGE_004, DESSAU_103, SD_210, type HingeSpec } from '@/lib/configurator/hardwareSpecs'
import { shapeForModel, type HardwareShape } from '@/lib/configurator/hardwareShapes'

const M = 0.001

export type HardwareModel = 'balge' | 'dessau' | 'sd210' | 'roller' | 'kp006' | 'kupe' | 'cap' | 'kp002' | 'kp001' | 'connector'

export function hingeSpecByModel(model: string): HingeSpec {
  return model === 'dessau' ? DESSAU_103 : BALGE_004
}

// Резолвер артикул петли → модель для 3D.
export function hingeModelFromCode(code?: string | null): 'balge' | 'dessau' {
  return code && /dessau/i.test(code) ? 'dessau' : 'balge'
}

// Петля стекло-стекло: две пятки на стёклах + центральный барабан-ось.
// Balge — скруглённые пятки, Dessau — прямоугольные (премиум). По реальным чертежам.
function Hinge({ model, material }: { model: 'balge' | 'dessau'; material: THREE.Material }) {
  const s = hingeSpecByModel(model)
  const plateW = s.plateW * M
  const bodyH = s.bodyH * M
  const thk = s.plateThk * M
  const dx = (s.gap / 2 + s.plateW / 2) * M
  const barrelR = (s.gap / 2 + 2) * M
  const plate = (x: number) => model === 'balge'
    ? (
        <RoundedBox key={x} args={[plateW, bodyH, thk]} radius={Math.min(plateW, bodyH) * 0.18} smoothness={3}
          position={[x, 0, 0]} material={material} castShadow />
      )
    : (
        <mesh key={x} position={[x, 0, 0]} material={material} castShadow>
          <boxGeometry args={[plateW, bodyH, thk]} />
        </mesh>
      )
  return (
    <group>
      {plate(-dx)}
      {plate(dx)}
      <mesh material={material} castShadow>
        <cylinderGeometry args={[barrelR, barrelR, bodyH, 20]} />
      </mesh>
    </group>
  )
}

// Петля стекло-СТЕНА: пятка на стекле двери + ось + кронштейн, уходящий к стене (−Z).
function HingeWall({ model, material }: { model: 'balge' | 'dessau'; material: THREE.Material }) {
  const s = hingeSpecByModel(model)
  const plateW = s.plateW * M, bodyH = s.bodyH * M, thk = s.plateThk * M
  const barrelR = (s.gap / 2 + 2) * M
  return (
    <group>
      <RoundedBox args={[plateW, bodyH, thk]} radius={Math.min(plateW, bodyH) * 0.18} smoothness={3}
        position={[plateW / 2 + barrelR, 0, 0]} material={material} castShadow />
      <mesh material={material} castShadow>
        <cylinderGeometry args={[barrelR, barrelR, bodyH, 20]} />
      </mesh>
      {/* кронштейн к стене (за петлёй) */}
      <mesh position={[0, 0, -(plateW * 0.55 + barrelR)]} material={material} castShadow>
        <boxGeometry args={[bodyH * 0.9, bodyH * 0.9, plateW * 1.1]} />
      </mesh>
    </group>
  )
}

// Ручка-кноб: круглая ручка-набалдашник, выступает наружу двери (−Z local).
function HandleKnob({ material }: { material: THREE.Material }) {
  return (
    <group>
      <mesh position={[0, 0, -9 * M]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
        <cylinderGeometry args={[5 * M, 5 * M, 18 * M, 18]} />
      </mesh>
      <mesh position={[0, 0, -20 * M]} material={material} castShadow>
        <sphereGeometry args={[13 * M, 22, 16]} />
      </mesh>
    </group>
  )
}

// Ручка-скоба SD-210/L230: два плеча-выноса + вертикальный хват. Двусторонняя,
// но в визуале рисуем внешнюю сторону (в −Z, к зрителю). По реальному чертежу.
function HandleSD210({ material }: { material: THREE.Material }) {
  const s = SD_210
  const arm = s.armReach * M
  const bar = s.barSection * M
  const gripR = s.gripDia / 2 * M
  const grip = s.gripLen * M
  const halfPitch = s.boltPitch / 2 * M
  const armZ = -arm / 2
  return (
    <group>
      {[halfPitch, -halfPitch].map((y, i) => (
        <mesh key={i} position={[0, y, armZ]} material={material} castShadow>
          <boxGeometry args={[bar, bar, arm]} />
        </mesh>
      ))}
      <mesh position={[0, 0, -arm + gripR]} material={material} castShadow>
        <cylinderGeometry args={[gripR, gripR, grip, 16]} />
      </mesh>
    </group>
  )
}

// Каретка раздвижной РД-001 (Hip System): обхватывает штангу 30×10 двумя колёсами
// (сверху и снизу бруса) + планка-зажим к стеклу створки. На двери две каретки —
// это и есть «4 ролика», все СВЕРХУ (снизу двери креплений нет). Штанга вдоль X.
function SlidingRoller({ material }: { material: THREE.Material }) {
  return (
    <group>
      {[16 * M, -16 * M].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
          <cylinderGeometry args={[20 * M, 20 * M, 12 * M, 28]} />
        </mesh>
      ))}
      {/* планка каретки к стеклу */}
      <mesh position={[0, 0, 0]} material={material} castShadow>
        <boxGeometry args={[15 * M, 36 * M, 9 * M]} />
      </mesh>
    </group>
  )
}

// КП-006 — крепёж трубы к СТЕКЛУ (L-кронштейн 87×40×18.5 по чертежу). П-зажим на
// верхнюю кромку стекла (у z=0) + вынос к трубе (+Z), который смещает трубу от
// стекла. Ширина 18.5 мм вдоль трубы (X).
function KP006({ material }: { material: THREE.Material }) {
  const w = 18.5 * M
  const arm = 44 * M
  return (
    <group>
      {/* вынос-планка к трубе (вдоль +Z, сверху) */}
      <mesh position={[0, 8 * M, arm / 2]} material={material} castShadow>
        <boxGeometry args={[w, 16 * M, arm]} />
      </mesh>
      {/* П-зажим на кромке стекла: две щеки по граням стекла (у z=0) */}
      {[-6 * M, 6 * M].map((z, i) => (
        <mesh key={i} position={[0, -6 * M, z]} material={material} castShadow>
          <boxGeometry args={[w, 26 * M, 4 * M]} />
        </mesh>
      ))}
      <mesh position={[0, 6 * M, 0]} material={material} castShadow>
        <boxGeometry args={[w, 8 * M, 14 * M]} />
      </mesh>
    </group>
  )
}

// КП-002 — крепёж трубы к СТЕНЕ (блок 31×40×18 по чертежу). Труба входит в паз,
// блок винтом к стене. X — вдоль трубы, +Z — к стене.
function KP002({ material }: { material: THREE.Material }) {
  return (
    <mesh material={material} castShadow>
      <boxGeometry args={[18 * M, 40 * M, 31 * M]} />
    </mesh>
  )
}

// КП-001 — крепёж угла (М7): труба приходит перпендикулярно к боковому стеклу.
// Блок 36×32 с пазом под трубу 30×11 + U-скоба снизу, одевается на кромку
// перпендикулярного стекла. По чертежу.
function KP001({ material }: { material: THREE.Material }) {
  return (
    <group>
      {/* тело блока (принимает трубу перпендикулярно) */}
      <mesh position={[0, 5 * M, 0]} material={material} castShadow>
        <boxGeometry args={[36 * M, 32 * M, 22 * M]} />
      </mesh>
      {/* U-скоба снизу — на кромку бокового стекла (две щеки по граням) */}
      {[-6 * M, 6 * M].map((x, i) => (
        <mesh key={i} position={[x, -16 * M, 0]} material={material} castShadow>
          <boxGeometry args={[4 * M, 22 * M, 22 * M]} />
        </mesh>
      ))}
    </group>
  )
}

// Ручка-купе КУ-002: круглая утопленная чаша заподлицо со стеклом двери. Диск
// смотрит наружу (плоскость ⊥ нормали двери → после rotY это ±Z-local).
function KupeHandle({ material }: { material: THREE.Material }) {
  return (
    <group rotation={[Math.PI / 2, 0, 0]}>
      <mesh material={material} castShadow>
        <cylinderGeometry args={[26 * M, 26 * M, 6 * M, 28]} />
      </mesh>
      <mesh position={[0, -3 * M, 0]} material={material}>
        <cylinderGeometry args={[18 * M, 18 * M, 5 * M, 28]} />
      </mesh>
    </group>
  )
}

// Заглушка штанги 30×10: торцевой колпачок на конце штанги. Штанга вдоль X —
// колпачок закрывает торец (в ±X), чуть крупнее сечения бруса.
function TubeCap({ material }: { material: THREE.Material }) {
  return (
    <mesh material={material} castShadow>
      <boxGeometry args={[16 * M, 36 * M, 16 * M]} />
    </mesh>
  )
}

// Соединитель труб (45×17) — стыкует два отрезка трубы под углом (углы трапеции).
// Хром, V-образный: два плеча под ~135°, лежит на стыке труб сверху.
function TubeConnector({ material }: { material: THREE.Material }) {
  const arm = 24 * M, w = 17 * M, h = 12 * M
  const half = (135 * Math.PI / 180) / 2
  return (
    <group>
      {[half, -half].map((a, i) => (
        <mesh key={i} position={[Math.sin(a) * arm / 2, 0, Math.cos(a) * arm / 2]} rotation={[0, a, 0]} material={material} castShadow>
          <boxGeometry args={[w, h, arm]} />
        </mesh>
      ))}
    </group>
  )
}

// FDC-5D — коннектор трубы под 45°: круглый шарнир (диск-фланец у поверхности +
// шаровой узел + короткий хомут на трубу). Ось трубы вдоль X.
function MountDiag45({ material }: { material: THREE.Material }) {
  return (
    <group>
      {/* диск-фланец к плоскости (стекло/стена), в −Z */}
      <mesh position={[0, 0, -6 * M]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
        <cylinderGeometry args={[15 * M, 15 * M, 6 * M, 24]} />
      </mesh>
      {/* шаровой шарнир */}
      <mesh material={material} castShadow>
        <sphereGeometry args={[11 * M, 22, 16]} />
      </mesh>
      {/* хомут на трубу (вдоль X) */}
      <mesh position={[10 * M, 0, 0]} rotation={[0, 0, Math.PI / 2]} material={material} castShadow>
        <cylinderGeometry args={[9 * M, 9 * M, 14 * M, 20]} />
      </mesh>
    </group>
  )
}

// FDK-5R — стабилизационное крепление: настенный круглый фланец + шток-муфта,
// принимающая штангу. Ось штанги вдоль X, стена в +Z (к трубе — внутрь).
function MountStabilizer({ material }: { material: THREE.Material }) {
  return (
    <group>
      {/* круглый настенный фланец */}
      <mesh position={[0, 0, 6 * M]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
        <cylinderGeometry args={[16 * M, 16 * M, 5 * M, 24]} />
      </mesh>
      {/* муфта-шток вдоль трубы */}
      <mesh position={[0, 0, -2 * M]} rotation={[0, 0, Math.PI / 2]} material={material} castShadow>
        <cylinderGeometry args={[10 * M, 10 * M, 22 * M, 20]} />
      </mesh>
    </group>
  )
}

export function Hardware({ model, shape, material }: { model: HardwareModel; shape?: string; material: THREE.Material }) {
  const sh = (shape as HardwareShape) || shapeForModel(model)
  const hingePlate = model === 'dessau' ? 'dessau' : 'balge'
  switch (sh) {
    case 'hinge-wall': return <HingeWall model={hingePlate} material={material} />
    case 'handle-bar': return <HandleSD210 material={material} />
    case 'handle-knob': return <HandleKnob material={material} />
    case 'handle-inset': return <KupeHandle material={material} />
    case 'roller': return <SlidingRoller material={material} />
    case 'mount-glass': return <KP006 material={material} />
    case 'mount-wall': return <KP002 material={material} />
    case 'mount-corner': return <KP001 material={material} />
    case 'mount-diag45': return <MountDiag45 material={material} />
    case 'mount-stabilizer': return <MountStabilizer material={material} />
    case 'connector': return <TubeConnector material={material} />
    case 'cap': return <TubeCap material={material} />
    case 'hinge-glass': default: return <Hinge model={hingePlate} material={material} />
  }
}
