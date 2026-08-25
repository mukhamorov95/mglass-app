'use client'

import * as THREE from 'three'
import { Canvas, type RootState } from '@react-three/fiber'
import {
  OrbitControls, Environment, Lightformer, ContactShadows,
  MeshTransmissionMaterial, MeshReflectorMaterial,
} from '@react-three/drei'
import { Suspense, useMemo } from 'react'
import type { MModel } from '@/lib/configurator/arrangement'
import { buildFromModel, type Assembly, type Niche, type MDims, type GlassTint, type HardwareChoice, type MVariant } from './scene/assembly'
import { Hardware } from './scene/hardware'

// Матовые финиши — выше шероховатость (меньше зеркальность).
const MATTE = new Set(['satin', 'black', 'gunmetal', 'brgold', 'brrose'])

// PBR-профиль на каждый цвет фурнитуры: полированные (хром/золото/роза) —
// зеркальные с лаком (clearcoat); матовые (сатин/оружейка/браш) — шершавые;
// чёрный/белый — крашеные (metalness ниже). Ближе к каталожному эскизу.
type FinishMat = { color: string; metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number; env: number }
const FINISH_MATERIAL: Record<string, FinishMat> = {
  chrome:   { color: '#e2e6e9', metalness: 1,   roughness: 0.05, clearcoat: 1,   clearcoatRoughness: 0.03, env: 1.9 },
  satin:    { color: '#c6ccd0', metalness: 1,   roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3,  env: 1.3 },
  black:    { color: '#212428', metalness: 0.6, roughness: 0.5,  clearcoat: 0.35,clearcoatRoughness: 0.4,  env: 0.9 },
  gunmetal: { color: '#3b4045', metalness: 0.92,roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3,  env: 1.1 },
  bronze:   { color: '#7d5a3a', metalness: 1,   roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3,  env: 1.1 },
  gold:     { color: '#caa42a', metalness: 1,   roughness: 0.13, clearcoat: 0.8, clearcoatRoughness: 0.06, env: 1.7 },
  brgold:   { color: '#b8974a', metalness: 1,   roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.35, env: 1.2 },
  white:    { color: '#eceae4', metalness: 0.2, roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.5,  env: 0.8 },
  rose:     { color: '#c98f78', metalness: 1,   roughness: 0.15, clearcoat: 0.7, clearcoatRoughness: 0.08, env: 1.6 },
  brrose:   { color: '#b98a78', metalness: 1,   roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.35, env: 1.2 },
}

// Dev-хук съёмки: при создании сцены кладём в window.__r3fRender() синхронный
// кадр (gl.render, минуя rAF) — чтобы снимать превью, когда вкладка «скрыта» под
// автоматизацией (браузер глушит requestAnimationFrame). Только вне прода.
function onCanvasCreated(state: RootState) {
  if (process.env.NODE_ENV === 'production') return
  const w = window as unknown as { __r3fRender?: () => void }
  w.__r3fRender = () => state.gl.render(state.scene, state.camera)
}

// Процедурная плитка ниши: одна крупная плитка с тонким швом (CanvasTexture,
// офлайн). Repeat тиражирует её в аккуратную сетку — без резкой «шахматки».
function makeTileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  const grout = 4
  ctx.fillStyle = '#c2c0ba'                       // шов
  ctx.fillRect(0, 0, 256, 256)
  const g = ctx.createLinearGradient(0, 0, 190, 256)
  g.addColorStop(0, '#efeee9')
  g.addColorStop(0.5, '#e8e6e0')
  g.addColorStop(1, '#e0ded7')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 256 - grout, 256 - grout)    // плитка с швом справа/снизу
  // лёгкие прожилки (мрамор), низкая заметность
  ctx.strokeStyle = 'rgba(150,147,140,0.16)'
  ctx.lineWidth = 1.4
  const veins = [[30, 70, 130, 30, 210, 120], [200, 20, 150, 130, 230, 230], [40, 200, 120, 170, 90, 250]]
  for (const [x1, y1, cx, cy, x2, y2] of veins) {
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.quadraticCurveTo(cx, cy, x2, y2); ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

const TILE_M = 0.34   // видимый размер плитки, м (крупный формат)

function tiledMaterial(base: THREE.CanvasTexture, uM: number, vM: number) {
  const t = base.clone()
  t.needsUpdate = true
  t.repeat.set(Math.max(1, uM / TILE_M), Math.max(1, vM / TILE_M))
  return t
}

function NicheMesh({ niche }: { niche: Niche }) {
  const { w, depth, wallH, trayH, walls } = niche
  const base = useMemo(() => makeTileTexture(), [])
  const WH = wallH + 0.4                    // стены выше кабины (до «потолка» ниши)
  const EXT = 1.2                           // вынос стен/пола за габарит — «угол комнаты»
  const FW = w + 2.6, FD = depth + 2.6      // большой облицованный пол
  const floorMat = useMemo(() => tiledMaterial(base, FW, FD), [base, FW, FD])
  const backMat = useMemo(() => tiledMaterial(base, w + EXT, WH), [base, w, WH])
  const sideMat = useMemo(() => tiledMaterial(base, depth + EXT, WH), [base, depth, WH])
  const tile = (map: THREE.Texture) =>
    <meshStandardMaterial map={map} color="#f2f0ea" roughness={0.8} metalness={0.03} envMapIntensity={0.5} />

  return (
    <group>
      {/* большой облицованный пол — полированный керамогранит, слабо зеркалит кабину */}
      <mesh position={[w / 2, 0, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FW, FD]} />
        <MeshReflectorMaterial
          map={floorMat}
          resolution={512}
          mixBlur={10}
          mixStrength={0.5}
          blur={[400, 120]}
          mirror={0}
          roughness={0.85}
          depthScale={1.1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1.3}
          color="#f2f0ea"
          metalness={0.04}
        />
      </mesh>
      {walls.back && (
        <mesh position={[w / 2, WH / 2, depth]} rotation={[0, Math.PI, 0]} receiveShadow>
          <planeGeometry args={[w + EXT, WH]} />
          {tile(backMat)}
        </mesh>
      )}
      {walls.right && (
        <mesh position={[w, WH / 2, depth / 2]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth + EXT, WH]} />
          {tile(sideMat)}
        </mesh>
      )}
      {walls.left && (
        <mesh position={[0, WH / 2, depth / 2]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth + EXT, WH]} />
          {tile(sideMat.clone())}
        </mesh>
      )}
      {/* поддон */}
      <mesh position={[w / 2, trayH / 2, depth / 2]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.05, trayH, depth + 0.05]} />
        <meshStandardMaterial color="#f1efea" roughness={0.3} metalness={0.05} envMapIntensity={0.8} />
      </mesh>
    </group>
  )
}

function Assembly3D({ assembly, metalMat, glassTint }: { assembly: Assembly; metalMat: THREE.Material; glassTint: GlassTint }) {
  // Кабина поднята на поддон.
  return (
    <group position={[0, assembly.niche.trayH, 0]}>
      {assembly.glass.map(g => (
        <mesh key={g.key} position={g.pos} rotation={[0, g.rotY, 0]} castShadow>
          <boxGeometry args={g.size} />
          <MeshTransmissionMaterial
            transmission={0.96}
            thickness={0.008}
            roughness={0.03}
            ior={1.52}
            chromaticAberration={0.02}
            anisotropy={0.04}
            distortion={0}
            temporalDistortion={0}
            samples={6}
            resolution={512}
            color={glassTint.color}
            attenuationColor={glassTint.attenuation}
            attenuationDistance={glassTint.distance}
            clearcoat={0.9}
            clearcoatRoughness={0.04}
          />
        </mesh>
      ))}
      {assembly.metal.map(m => (
        <mesh key={m.key} position={m.pos} rotation={[0, m.rotY, 0]} material={metalMat} castShadow>
          <boxGeometry args={m.size} />
        </mesh>
      ))}
      {assembly.hardware.map(h => (
        <group key={h.key} position={h.pos} rotation={[0, h.rotY, 0]}>
          <Hardware model={h.model} shape={h.shape} material={metalMat} />
        </group>
      ))}
    </group>
  )
}

function Studio() {
  return (
    <Environment resolution={384} frames={1}>
      <color attach="background" args={['#d3d7dd']} />
      {/* верхний софт-бокс — основной свет */}
      <Lightformer form="rect" intensity={3.2} position={[0, 5, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 5, 1]} color="#ffffff" />
      {/* боковые заполняющие (холодный слева, тёплый справа) */}
      <Lightformer form="rect" intensity={1.6} position={[-5, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 6, 1]} color="#e6eeff" />
      <Lightformer form="rect" intensity={1.6} position={[5, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 6, 1]} color="#fff1e0" />
      {/* контровой сзади — блики на кромках хрома и стекла */}
      <Lightformer form="rect" intensity={2.4} position={[0, 3, -5]} scale={[7, 4, 1]} color="#ffffff" />
      <Lightformer form="ring" intensity={1.4} position={[3, 2, 4]} scale={2.2} color="#ffffff" />
      {/* вертикальные софт-боксы — вытянутые «студийные» блики-полосы на хроме и стекле */}
      <Lightformer form="rect" intensity={2.2} position={[-2.2, 2.5, 3.2]} rotation={[0, 0, 0]} scale={[0.35, 5, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={2.0} position={[2.4, 2.5, 3.2]} rotation={[0, 0, 0]} scale={[0.3, 5, 1]} color="#f4f8ff" />
    </Environment>
  )
}

export default function Partition3D(
  { model, dims, thickness, finishHex, finishId, glassTint, doorOpen = true, choice, variant }:
  { model: MModel; dims: MDims; thickness: number; finishHex: string; finishId: string; glassTint: GlassTint; doorOpen?: boolean; choice?: HardwareChoice; variant?: MVariant },
) {
  const assembly = useMemo(() => buildFromModel(model, dims, thickness, doorOpen, choice, variant), [model, dims, thickness, doorOpen, choice, variant])
  // PBR-материал финиша для профилей и фурнитуры. Профиль цвета → MeshPhysicalMaterial
  // с clearcoat (реалистичный лак/зеркало); фолбэк на hex, если цвет неизвестен.
  const metalMat = useMemo(() => {
    const f = FINISH_MATERIAL[finishId]
    if (!f) return new THREE.MeshStandardMaterial({ color: finishHex, metalness: 1, roughness: MATTE.has(finishId) ? 0.42 : 0.06, envMapIntensity: 1.45 })
    const m = new THREE.MeshPhysicalMaterial({
      color: f.color, metalness: f.metalness, roughness: f.roughness,
      clearcoat: f.clearcoat, clearcoatRoughness: f.clearcoatRoughness, envMapIntensity: f.env,
    })
    return m
  }, [finishId, finishHex])
  const { w, h, d } = assembly.bounds
  const span = Math.max(w, h, d)
  const camDist = span * 1.7 + 0.9
  const cx = w / 2, cz = d / 2
  const ty = assembly.niche.trayH + h * 0.45

  return (
    <div className="w-full h-[420px] md:h-[480px] rounded-xl overflow-hidden bg-gradient-to-b from-[#f2f1ee] to-[#e4e2dd]">
      <Canvas
        shadows
        dpr={[1, 2]}
        style={{ width: '100%', height: '100%', display: 'block' }}
        resize={{ debounce: 0 }}
        camera={{ position: [cx - camDist * 0.58, ty + h * 0.26, cz - camDist * 1.05], fov: 33 }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.06 }}
        onCreated={onCanvasCreated}
      >
        <Suspense fallback={null}>
          <color attach="background" args={['#eef0ee']} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[cx - 4.5, ty + 6.5, cz - 5.5]} intensity={1.5} castShadow
            shadow-mapSize={[2048, 2048]} shadow-camera-far={24} shadow-bias={-0.0002} />
          <directionalLight position={[cx + 5, ty + 3, cz - 1]} intensity={0.5} color="#eaf0ff" />
          <NicheMesh niche={assembly.niche} />
          <Assembly3D assembly={assembly} metalMat={metalMat} glassTint={glassTint} />
          <ContactShadows position={[cx, 0.002, cz]} opacity={0.52} scale={span * 3.2} blur={2.5} far={span * 1.2} resolution={1024} />
          <Studio />
          <OrbitControls
            makeDefault
            enablePan={false}
            minPolarAngle={0.2}
            maxPolarAngle={Math.PI / 2.05}
            minDistance={span * 0.9}
            maxDistance={span * 3.5}
            target={[cx, ty, cz]}
          />
        </Suspense>
      </Canvas>
    </div>
  )
}
