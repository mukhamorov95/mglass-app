'use client'

import * as THREE from 'three'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Environment, Lightformer, ContactShadows } from '@react-three/drei'
import { Suspense, useMemo } from 'react'

// 3D-сцена зеркала (маршрут З9). Первый заход: стена, зеркало в габаритах
// расчёта, подсветка по выбранным сторонам и раковина под зеркалом — но только
// там, где она физически бывает. Качество наращиваем итерациями.

export type Mirror3DProps = {
  width: number      // мм
  height: number     // мм
  shape: string      // rect | circle | oval
  lit: boolean
  sides: { top: boolean; bottom: boolean; left: boolean; right: boolean }
  frame: string      // none | vetro | metal | ushape
}

const M = 0.001
// Правило владельца: под зеркало в рост раковину не поставишь. Раковину рисуем
// только у надраковинных габаритов; порог по высоте самого зеркала.
export const SINK_MAX_MIRROR_H = 1200      // мм
const SINK_TOP = 0.85                       // высота столешницы, м
const MIRROR_GAP = 0.25                     // зазор от столешницы до низа зеркала, м
const PLINTH = 0.1                          // низ высокого зеркала над полом, м

export function mirrorMount(heightMm: number) {
  const h = heightMm * M
  const withSink = heightMm <= SINK_MAX_MIRROR_H
  const bottom = withSink ? SINK_TOP + MIRROR_GAP : PLINTH
  return { withSink, bottom, centerY: bottom + h / 2 }
}

function Sink() {
  return (
    <group>
      {/* Столешница */}
      <mesh position={[0, SINK_TOP - 0.02, 0.24]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.04, 0.48]} />
        <meshStandardMaterial color="#e8e4dc" roughness={0.5} />
      </mesh>
      {/* Тумба */}
      <mesh position={[0, (SINK_TOP - 0.04) / 2, 0.22]} receiveShadow>
        <boxGeometry args={[1.16, SINK_TOP - 0.04, 0.44]} />
        <meshStandardMaterial color="#cfc7bb" roughness={0.7} />
      </mesh>
      {/* Чаша */}
      <mesh position={[0, SINK_TOP + 0.04, 0.24]} castShadow>
        <cylinderGeometry args={[0.19, 0.15, 0.12, 32]} />
        <meshStandardMaterial color="#fbfbf9" roughness={0.25} />
      </mesh>
      {/* Смеситель */}
      <mesh position={[0, SINK_TOP + 0.14, 0.06]} castShadow>
        <cylinderGeometry args={[0.016, 0.016, 0.26, 16]} />
        <meshStandardMaterial color="#c9ced2" metalness={1} roughness={0.15} />
      </mesh>
      <mesh position={[0, SINK_TOP + 0.26, 0.13]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.16, 16]} />
        <meshStandardMaterial color="#c9ced2" metalness={1} roughness={0.15} />
      </mesh>
    </group>
  )
}

function MirrorBody({ w, h, y, shape, frame }: { w: number; h: number; y: number; shape: string; frame: string }) {
  const round = shape === 'circle' || shape === 'oval'
  const framed = frame !== 'none'
  const frameColor = frame === 'metal' ? '#3a3d40' : '#b9bec2'
  return (
    <group position={[0, y, 0.012]}>
      {framed && (round
        ? <mesh position={[0, 0, -0.004]}>
            <cylinderGeometry args={[Math.min(w, h) / 2 + 0.02, Math.min(w, h) / 2 + 0.02, 0.012, 48]} />
            <meshStandardMaterial color={frameColor} metalness={0.8} roughness={0.35} />
          </mesh>
        : <mesh position={[0, 0, -0.004]}>
            <boxGeometry args={[w + 0.04, h + 0.04, 0.012]} />
            <meshStandardMaterial color={frameColor} metalness={0.8} roughness={0.35} />
          </mesh>)}
      {/* Само зеркало: сильно отражающая поверхность, а не прозрачное стекло. */}
      {round
        ? <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[Math.min(w, h) / 2, Math.min(w, h) / 2, 0.008, 48]} />
            <meshStandardMaterial color="#dfe7ea" metalness={1} roughness={0.06} envMapIntensity={2.2} />
          </mesh>
        : <mesh castShadow>
            <boxGeometry args={[w, h, 0.008]} />
            <meshStandardMaterial color="#dfe7ea" metalness={1} roughness={0.06} envMapIntensity={2.2} />
          </mesh>}
    </group>
  )
}

function Glow({ w, h, y, sides }: { w: number; h: number; y: number; sides: Mirror3DProps['sides'] }) {
  const t = 0.014
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#fff0c2' }), [])
  const bars: [number, number, number, number, number][] = []   // x, y, z, длина, вертикаль?
  if (sides.top)    bars.push([0, y + h / 2 + t, 0.006, w, 0])
  if (sides.bottom) bars.push([0, y - h / 2 - t, 0.006, w, 0])
  if (sides.left)   bars.push([-w / 2 - t, y, 0.006, h, 1])
  if (sides.right)  bars.push([w / 2 + t, y, 0.006, h, 1])
  return (
    <group>
      {bars.map(([x, by, z, len, vert], i) => (
        <mesh key={i} position={[x, by, z]} material={mat}>
          <boxGeometry args={vert ? [t * 1.6, len, t] : [len, t * 1.6, t]} />
        </mesh>
      ))}
    </group>
  )
}

export default function Mirror3D({ width, height, shape, lit, sides, frame }: Mirror3DProps) {
  const w = Math.max(0.1, width * M), h = Math.max(0.1, height * M)
  const { withSink, centerY } = mirrorMount(height)
  // Камера отъезжает под размер изделия: маленькое зеркало не должно тонуть в кадре.
  const dist = Math.max(1.9, Math.max(w, h) * 2.1)
  const look = withSink ? 1.25 : Math.max(0.9, centerY)

  return (
    <Canvas shadows dpr={[1, 1.8]} camera={{ position: [dist * 0.55, look + 0.35, dist], fov: 35 }}>
      <Suspense fallback={null}>
        <color attach="background" args={['#f1efec']} />
        <ambientLight intensity={0.5} />
        <directionalLight position={[2.5, 3.5, 2.5]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
        {/* Среду собираем сами, как в сцене душевых: пресет drei тянул бы HDR
            из внешней CDN на каждой загрузке экрана. */}
        <Environment resolution={256} frames={1}>
          <color attach="background" args={['#d7dade']} />
          <Lightformer form="rect" intensity={1.3} position={[0, 5, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 5, 1]} color="#ffffff" />
          <Lightformer form="rect" intensity={0.7} position={[-5, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 6, 1]} color="#e6eeff" />
          <Lightformer form="rect" intensity={0.7} position={[5, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 6, 1]} color="#fff1e0" />
          <Lightformer form="rect" intensity={0.9} position={[0, 3, 4]} scale={[6, 4, 1]} color="#ffffff" />
        </Environment>

        {/* Стена и пол — чтобы читался масштаб и высота подвеса. */}
        <mesh position={[0, 1.4, -0.02]} receiveShadow>
          <planeGeometry args={[4.5, 2.9]} />
          <meshStandardMaterial color="#e6e2db" roughness={0.9} />
        </mesh>
        <mesh position={[0, 0, 1.1]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[4.5, 2.4]} />
          <meshStandardMaterial color="#d9d3ca" roughness={0.95} />
        </mesh>

        {withSink && <Sink />}
        {lit && <Glow w={w} h={h} y={centerY} sides={sides} />}
        <MirrorBody w={w} h={h} y={centerY} shape={shape} frame={frame} />

        <ContactShadows position={[0, 0.001, 0.3]} opacity={0.35} scale={4} blur={2.4} far={2.5} />
        <OrbitControls enablePan={false} minDistance={1.1} maxDistance={6}
          minPolarAngle={0.6} maxPolarAngle={Math.PI / 2 - 0.05} target={[0, look, 0]} />
      </Suspense>
    </Canvas>
  )
}
