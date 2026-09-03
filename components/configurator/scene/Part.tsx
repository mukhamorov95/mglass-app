'use client'

import * as THREE from 'three'
import { RoundedBox } from '@react-three/drei'
import type { Prim, PartSpec, V3 } from '@/lib/configurator/parts/types'

const M = 0.001
const m3 = (v: V3): V3 => [v[0] * M, v[1] * M, v[2] * M]
const at = (v?: V3): V3 => (v ? m3(v) : [0, 0, 0])

// Ось примитива → поворот: цилиндр в three стоит вдоль Y, поэтому под 'x' и 'z'
// его кладут. Отдельная функция, чтобы паспорт не описывал повороты вручную.
function axisRot(axis?: 'x' | 'y' | 'z'): V3 {
  if (axis === 'x') return [0, 0, Math.PI / 2]
  if (axis === 'z') return [Math.PI / 2, 0, 0]
  return [0, 0, 0]
}

function Primitive({ pr, material }: { pr: Prim; material: THREE.Material }) {
  switch (pr.p) {
    case 'box': {
      const size = m3(pr.size)
      const rot = pr.rot ? (pr.rot.map(d => (d * Math.PI) / 180) as V3) : ([0, 0, 0] as V3)
      if (pr.round && pr.round > 0) {
        return <RoundedBox args={size} radius={pr.round * M} smoothness={3} position={at(pr.at)} rotation={rot} material={material} castShadow />
      }
      return (
        <mesh position={at(pr.at)} rotation={rot} material={material} castShadow>
          <boxGeometry args={size} />
        </mesh>
      )
    }
    case 'cyl': {
      const r = (pr.d / 2) * M, r2 = ((pr.d2 ?? pr.d) / 2) * M
      const rot = pr.rot ? (pr.rot.map(d => (d * Math.PI) / 180) as V3) : axisRot(pr.axis)
      return (
        <mesh position={at(pr.at)} rotation={rot} material={material} castShadow>
          <cylinderGeometry args={[r2, r, pr.len * M, 20]} />
        </mesh>
      )
    }
    case 'ball':
      return (
        <mesh position={at(pr.at)} material={material} castShadow>
          <sphereGeometry args={[(pr.d / 2) * M, 22, 16]} />
        </mesh>
      )
    case 'ring': {
      return (
        <mesh position={at(pr.at)} rotation={axisRot(pr.axis)} material={material} castShadow>
          <torusGeometry args={[(pr.d / 2) * M, (pr.thk / 2) * M, 10, 28]} />
        </mesh>
      )
    }
    case 'clamp': {
      // Обойма: коробка с габаритом «сечение + 2 стенки», надетая на штангу.
      // Рисуем телом — внутренняя полость не видна, а полигоны экономятся.
      const [sw, sh] = pr.section
      const outW = (sw + pr.wall * 2) * M, outH = (sh + pr.wall * 2) * M
      const len = pr.len * M
      const size: V3 = pr.axis === 'y' ? [outW, len, outH] : pr.axis === 'z' ? [outW, outH, len] : [len, outH, outW]
      return <RoundedBox args={size} radius={Math.min(pr.wall, 2) * M} smoothness={3} position={at(pr.at)} material={material} castShadow />
    }
    default:
      return null
  }
}

// Деталь по паспорту. Рамка: +Z наружу от поверхности, +Y вверх, +X вдоль.
export function Part({ spec, material }: { spec: PartSpec; material: THREE.Material }) {
  return (
    <group>
      {spec.geometry.map((pr, i) => <Primitive key={i} pr={pr} material={material} />)}
    </group>
  )
}
