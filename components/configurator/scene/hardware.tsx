'use client'

import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { BALGE_004, DESSAU_103, SD_210, type HingeSpec } from '@/lib/configurator/hardwareSpecs'

const M = 0.001

export type HardwareModel = 'balge' | 'dessau' | 'sd210' | 'roller' | 'holder' | 'kupe' | 'cap'

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
      {[15 * M, -15 * M].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
          <cylinderGeometry args={[11 * M, 11 * M, 11 * M, 24]} />
        </mesh>
      ))}
      {/* планка каретки к стеклу */}
      <mesh position={[0, 0, 0]} material={material} castShadow>
        <boxGeometry args={[15 * M, 42 * M, 9 * M]} />
      </mesh>
    </group>
  )
}

// Держатель штанги на стационарном стекле: обойма вокруг штанги 30×10 + зажим на
// стекле. Ставится по центру и ближе к свободному краю стационара.
function TubeHolder({ material }: { material: THREE.Material }) {
  return (
    <group>
      {/* обойма вокруг штанги */}
      <mesh material={material} castShadow>
        <boxGeometry args={[20 * M, 30 * M, 26 * M]} />
      </mesh>
      {/* зажим-планка на стекле (стекло позади штанги, к центру ниши) */}
      <mesh position={[0, 0, -15 * M]} material={material} castShadow>
        <boxGeometry args={[28 * M, 34 * M, 8 * M]} />
      </mesh>
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

export function Hardware({ model, material }: { model: HardwareModel; material: THREE.Material }) {
  if (model === 'roller') return <SlidingRoller material={material} />
  if (model === 'holder') return <TubeHolder material={material} />
  if (model === 'kupe') return <KupeHandle material={material} />
  if (model === 'cap') return <TubeCap material={material} />
  if (model === 'sd210') return <HandleSD210 material={material} />
  if (model === 'dessau') return <Hinge model="dessau" material={material} />
  return <Hinge model="balge" material={material} />
}
