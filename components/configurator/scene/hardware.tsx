'use client'

import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import { BALGE_004, DESSAU_103, SD_210, type HingeSpec } from '@/lib/configurator/hardwareSpecs'

const M = 0.001

export type HardwareModel = 'balge' | 'dessau' | 'sd210'

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
  const Plate = model === 'balge'
    ? ({ x }: { x: number }) => (
        <RoundedBox args={[plateW, bodyH, thk]} radius={Math.min(plateW, bodyH) * 0.18} smoothness={3}
          position={[x, 0, 0]} material={material} castShadow />
      )
    : ({ x }: { x: number }) => (
        <mesh position={[x, 0, 0]} material={material} castShadow>
          <boxGeometry args={[plateW, bodyH, thk]} />
        </mesh>
      )
  return (
    <group>
      <Plate x={-dx} />
      <Plate x={dx} />
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

// Каретка-ролик раздвижной РД-001 на штанге 30×10 (верхнеподвес). Упрощённый,
// но узнаваемый: корпус-обойма + два ролика. Точная геометрия — по PDF (позже).
function SlidingCarrier({ material }: { material: THREE.Material }) {
  const body = 34 * M
  return (
    <group>
      <mesh material={material} castShadow>
        <boxGeometry args={[40 * M, body, 22 * M]} />
      </mesh>
      {[-12 * M, 12 * M].map((x, i) => (
        <mesh key={i} position={[x, body / 2, 0]} rotation={[Math.PI / 2, 0, 0]} material={material} castShadow>
          <cylinderGeometry args={[9 * M, 9 * M, 16 * M, 16]} />
        </mesh>
      ))}
    </group>
  )
}

export function Hardware({ model, material }: { model: HardwareModel; material: THREE.Material }) {
  if (model === 'sd210') return <HandleSD210 material={material} />
  if (model === 'dessau') return <Hinge model="dessau" material={material} />
  return <Hinge model="balge" material={material} />
}
