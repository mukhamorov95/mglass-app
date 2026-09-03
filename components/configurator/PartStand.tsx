'use client'

import { useMemo } from 'react'
import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer } from '@react-three/drei'
import { Part } from './scene/Part'
import { placePart, surfaces } from '@/lib/configurator/parts/mount'
import type { PartSpec } from '@/lib/configurator/parts/types'

const M = 0.001

// Габарит детали по паспорту — чтобы камера и сетка подстраивались под деталь,
// а не под жёстко забитый масштаб.
function extent(spec: PartSpec): number {
  let max = 40
  for (const pr of spec.geometry) {
    const v = pr.p === 'box' ? Math.max(...pr.size)
      : pr.p === 'cyl' ? Math.max(pr.d, pr.len)
      : pr.p === 'ball' ? pr.d
      : pr.p === 'ring' ? pr.d
      : Math.max(pr.section[0], pr.section[1], pr.len)
    const off = pr.at ? Math.max(...pr.at.map(Math.abs)) : 0
    max = Math.max(max, v + off * 2)
  }
  return max
}

// Поверхность посадки: то, к чему деталь крепится в жизни. Без неё «висит в воздухе»
// невозможно отличить от «сидит правильно».
function Surface({ spec, size }: { spec: PartSpec; size: number }) {
  const s = size * M
  const glass = new THREE.MeshPhysicalMaterial({ color: '#cfe0dd', transmission: 0.7, thickness: 0.01, roughness: 0.08, transparent: true, opacity: 0.5 })
  const solid = new THREE.MeshStandardMaterial({ color: '#e8e6e1', roughness: 0.9 })
  const t = (spec.mount.glassMm?.[0] ?? 8) * M

  switch (spec.mount.on) {
    case 'glass-face':
      // полотно занимает z от 0 до −t: деталь садится на грань z = 0
      return (
        <mesh position={[0, 0, -t / 2]} material={glass}>
          <boxGeometry args={[s, s, t]} />
        </mesh>
      )
    case 'glass-edge':
      // торец полотна в плоскости z = 0, полотно уходит в −Z
      return (
        <mesh position={[0, 0, -s / 2]} material={glass}>
          <boxGeometry args={[t, s, s]} />
        </mesh>
      )
    case 'tube':
    case 'tube-end': {
      const [w, h] = spec.mount.clamps ?? [30, 10]
      const len = spec.mount.on === 'tube' ? s : s / 2
      const shift = spec.mount.on === 'tube' ? 0 : -len / 2
      return (
        <mesh position={[shift, 0, 0]} material={solid}>
          <boxGeometry args={[len, h * M, w * M]} />
        </mesh>
      )
    }
    case 'wall':
      return (
        <mesh position={[0, 0, -0.005]} material={solid}>
          <boxGeometry args={[s, s, 0.01]} />
        </mesh>
      )
    default:
      return null
  }
}

export function PartStand({ spec, withSurface = true }: { spec: PartSpec; withSurface?: boolean }) {
  const size = extent(spec)
  const cam = size * M * 2.6
  const metal = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#cfd2d4', metalness: 0.95, roughness: 0.22, clearcoat: 0.5, envMapIntensity: 1.1,
  }), [])

  // Вторая половина сквозной детали — показываем и её: принимают деталь целиком.
  const mirror = useMemo(() => {
    if (!spec.mount.through) return null
    // На стенде полотно занимает z от 0 до −t, значит его ЦЕНТР на −t/2: только тогда
    // грань попадает в ноль детали, а зеркальная половина — на дальнюю грань, а не в середину.
    const t = spec.mount.glassMm?.[0] ?? 8
    const r = placePart(spec, surfaces.glassFace([0, 0, -t * M / 2], [0, 1], [1, 0], t))
    return r.ok ? r.placement.mirror ?? null : null
  }, [spec])

  return (
    <div className="w-full h-[460px] rounded-lg overflow-hidden bg-gradient-to-b from-[#f4f3f0] to-[#e6e4df]">
      <Canvas shadows dpr={[1, 2]} style={{ width: '100%', height: '100%', display: 'block' }}
        camera={{ position: [cam * 0.9, cam * 0.55, cam], fov: 32 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}>
        <color attach="background" args={['#f1efec']} />
        <ambientLight intensity={0.45} />
        <directionalLight position={[0.4, 0.6, 0.5]} intensity={1.6} castShadow />
        <directionalLight position={[-0.5, 0.3, -0.4]} intensity={0.5} />
        {/* Свет тот же, что в конфигураторе: софт-боксы прямо в сцене, без внешнего HDR
            (preset тянул файл с CDN — стенд оставался белым, если сети нет). */}
        <Environment resolution={256} frames={1}>
          <color attach="background" args={['#d6d9de']} />
          <Lightformer form="rect" intensity={3} position={[0, 3, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[6, 4, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={1.6} position={[-3, 1, 2]} rotation={[0, Math.PI / 2, 0]} scale={[3, 4, 1]} color="#e6eeff" />
          <Lightformer form="rect" intensity={1.6} position={[3, 1, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 4, 1]} color="#fff1e0" />
          <Lightformer form="rect" intensity={2.2} position={[0, 2, -4]} scale={[5, 3, 1]} color="#ffffff" />
        </Environment>

        {/* сетка 10 мм — линейка, по которой размер читается глазом */}
        <gridHelper args={[size * M * 3, Math.round(size * 3 / 10), '#c9c6c0', '#e0ddd7']}
          position={[0, -size * M * 0.75, 0]} />
        {withSurface && <Surface spec={spec} size={size * 1.6} />}
        {/* красная нить — сама плоскость посадки (z = 0) */}
        {withSurface && (
          <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.0004, 0.0004, size * M * 1.6, 6]} />
            <meshBasicMaterial color="#d9534f" />
          </mesh>
        )}

        <Part spec={spec} material={metal} />
        {mirror && (
          <group position={mirror.pos} rotation={[0, mirror.rotY, 0]}>
            <Part spec={spec} material={metal} />
          </group>
        )}

        <OrbitControls makeDefault enablePan={false} minDistance={cam * 0.4} maxDistance={cam * 3} />
      </Canvas>
    </div>
  )
}
