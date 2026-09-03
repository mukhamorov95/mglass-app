'use client'

import * as THREE from 'three'
import { Canvas, type RootState } from '@react-three/fiber'
import {
  OrbitControls, Environment, Lightformer, ContactShadows,
  MeshTransmissionMaterial, Edges, RoundedBox,
} from '@react-three/drei'
import { EffectComposer, N8AO, Bloom, Vignette, SMAA } from '@react-three/postprocessing'
import { Suspense, useMemo, useState, useRef, useEffect, useCallback } from 'react'
import type { MModel } from '@/lib/configurator/arrangement'
import { nodeRole } from '@/lib/configurator/kit'
import { getPart } from '@/lib/configurator/parts/registry'
import { Part } from './scene/Part'
import { buildFromModel, type Assembly, type Niche, type MDims, type GlassTint, type HardwareChoice, type MVariant } from './scene/assembly'
import { Hardware } from './scene/hardware'

// Что вернёт клик по детали: узел геометрии + как он нарисован. Позицию комплекта
// и цену сюда НЕ тащим — их знает вызывающий (у него есть варианты из /options).
export type PickedNode = {
  key: string
  kind: 'hardware' | 'metal'
  spec?: string          // код узла для прайса (mount-wall, tube-perp90, …)
  model?: string         // внутренний код геометрии
  shape?: string         // форма задана явно; пусто → угадана по названию позиции
  role?: string | null   // роль в комплекте — считает kit.nodeRole, тем же правилом, что и прайс
}

// Матовые финиши — выше шероховатость (меньше зеркальность).
const MATTE = new Set(['satin', 'black', 'gunmetal', 'brgold', 'brrose'])

// PBR-профиль на каждый цвет фурнитуры: полированные (хром/золото/роза) —
// зеркальные с лаком (clearcoat); матовые (сатин/оружейка/браш) — шершавые;
// чёрный/белый — крашеные (metalness ниже). Ближе к каталожному эскизу.
type FinishMat = { color: string; metalness: number; roughness: number; clearcoat: number; clearcoatRoughness: number; env: number }
const FINISH_MATERIAL: Record<string, FinishMat> = {
  chrome:   { color: '#e6eaee', metalness: 1,   roughness: 0.025,clearcoat: 1,   clearcoatRoughness: 0.02, env: 2.5 },
  satin:    { color: '#c6ccd0', metalness: 1,   roughness: 0.32, clearcoat: 0.4, clearcoatRoughness: 0.3,  env: 1.3 },
  black:    { color: '#212428', metalness: 0.6, roughness: 0.5,  clearcoat: 0.35,clearcoatRoughness: 0.4,  env: 0.9 },
  gunmetal: { color: '#3b4045', metalness: 0.92,roughness: 0.34, clearcoat: 0.5, clearcoatRoughness: 0.3,  env: 1.1 },
  bronze:   { color: '#7d5a3a', metalness: 1,   roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.3,  env: 1.1 },
  gold:     { color: '#caa42a', metalness: 1,   roughness: 0.11, clearcoat: 0.85,clearcoatRoughness: 0.05, env: 2.0 },
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

// R2 · Плитка: крупноформатный керамогранит 600×1200 со смещённой раскладкой.
// Ячейка текстуры — 1200×2400 мм (2×2 плитки, нижний ряд сдвинут на половину),
// поэтому шов не выстраивается в сплошную сетку и не читается «кафелем 10×10».
// Три карты вместо одной: цвет, рельеф (только шов) и шероховатость (шов матовее).
// Раньше рельеф брался с карты цвета — и прожилки камня выдавливались как борозды.
const TILE_W = 0.6, TILE_H = 1.2          // м
const CELL_W = TILE_W * 2, CELL_H = TILE_H * 2
const GROUT_MM = 3                        // тонкий шов, как в каталожных рендерах

type TileMaps = { color: THREE.CanvasTexture; height: THREE.CanvasTexture; rough: THREE.CanvasTexture }

function drawTileCell(kind: 'color' | 'height' | 'rough'): HTMLCanvasElement {
  const PX = 1024                                   // пикселей на 1200 мм ширины ячейки
  const c = document.createElement('canvas')
  c.width = PX; c.height = PX * (CELL_H / CELL_W)
  const ctx = c.getContext('2d')!
  const mm = PX / (CELL_W * 1000)                   // пикселей на миллиметр
  const g = GROUT_MM * mm
  const tw = TILE_W * 1000 * mm, th = TILE_H * 1000 * mm

  const groutFill = kind === 'color' ? '#c3bcae' : kind === 'height' ? '#000000' : '#ffffff'
  ctx.fillStyle = groutFill
  ctx.fillRect(0, 0, c.width, c.height)

  const paintTile = (x: number, y: number, seed: number) => {
    const x0 = x + g / 2, y0 = y + g / 2, w = tw - g, h = th - g
    if (kind === 'height') { ctx.fillStyle = '#ffffff'; ctx.fillRect(x0, y0, w, h); return }
    if (kind === 'rough')  { ctx.fillStyle = '#b4b4b4'; ctx.fillRect(x0, y0, w, h); return }
    // цвет: тёплый бежевый с очень слабым уходом тона по диагонали
    const grd = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h)
    const a = 4 + ((seed * 7) % 5)
    grd.addColorStop(0, `rgb(${232 - a},${227 - a},${216 - a})`)
    grd.addColorStop(0.55, `rgb(${226 - a},${220 - a},${208 - a})`)
    grd.addColorStop(1, `rgb(${219 - a},${213 - a},${200 - a})`)
    ctx.fillStyle = grd
    ctx.fillRect(x0, y0, w, h)
    // Прожилки камня. Держим их НА ГРАНИ ЗАМЕТНОСТИ: сплошная жилка через всю
    // плитку читается как полоса ткани, а не как керамогранит. Короткие отрезки,
    // разные у каждой плитки, прозрачность в пределах шума.
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip()
    ctx.lineWidth = Math.max(1, w * 0.004)
    for (let i = 0; i < 4; i++) {
      const k = seed * 5 + i * 13
      const sx = x0 + ((k * 137) % 100) / 100 * w
      const sy = y0 + ((k * 71) % 100) / 100 * h
      const len = h * (0.18 + ((k * 29) % 30) / 100)
      const bend = w * (((k * 17) % 20) - 10) / 100
      ctx.strokeStyle = `rgba(172,166,153,${0.035 + ((k * 11) % 3) / 100})`
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.quadraticCurveTo(sx + bend, sy + len * 0.5, sx + bend * 0.3, sy + len)
      ctx.stroke()
    }
    ctx.restore()
  }

  // верхний ряд — без сдвига, нижний — на половину плитки (кирпичная раскладка)
  for (let i = -1; i <= 2; i++) paintTile(i * tw, 0, i + 2)
  for (let i = -1; i <= 2; i++) paintTile(i * tw + tw / 2, th, i + 7)
  return c
}

function makeTileMaps(): TileMaps {
  const mk = (kind: 'color' | 'height' | 'rough') => {
    const tex = new THREE.CanvasTexture(drawTileCell(kind))
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.anisotropy = 8
    return tex
  }
  return { color: mk('color'), height: mk('height'), rough: mk('rough') }
}

// Размножение ячейки по поверхности. Ячейка — 2×2 плитки, поэтому делим на CELL,
// а не на размер плитки: иначе смещённый ряд рвался бы на стыке повторов.
function tiledMaps(maps: TileMaps, uM: number, vM: number): TileMaps {
  const cl = (tex: THREE.CanvasTexture) => {
    const c = tex.clone()
    c.needsUpdate = true
    c.repeat.set(Math.max(1, uM / CELL_W), Math.max(1, vM / CELL_H))
    return c
  }
  return { color: cl(maps.color), height: cl(maps.height), rough: cl(maps.rough) }
}

// R5 · Поддон: акрил с бортиком и утопленным полем, а не плита.
// Собран из тел, а не вырезан булевой операцией: основание чуть ниже верха, по
// периметру — четыре бортика. Верх основания и есть утопленное поле, поэтому
// лишней геометрии нет, а бортик читается кромкой и тенью.
// Отражение в полу — трафаретом, а не вторым проходом рендера: off-screen проход
// (MeshReflectorMaterial) конфликтует с преломляющим стеклом и уже давал чёрный
// кадр на части видеокарт. Трафарет — состояние материала, лишних проходов нет.
const FLOOR_STENCIL = 1

// depthTest выключен намеренно: отражённая геометрия лежит НИЖЕ пола и была бы им
// закрыта. Границу задаёт трафарет, порядок — renderOrder.
function stencilClip<M extends THREE.Material>(m: M, opacity: number): M {
  m.stencilWrite = true
  m.stencilRef = FLOOR_STENCIL
  m.stencilFunc = THREE.EqualStencilFunc
  m.depthTest = false
  m.depthWrite = false
  m.transparent = true
  m.opacity = opacity
  return m
}

const TRAY_RIM = 0.035        // ширина бортика, м
const TRAY_RECESS = 0.012     // на сколько поле утоплено относительно бортика

function Tray({ w, depth, trayH, mirror }: { w: number; depth: number; trayH: number; mirror?: boolean }) {
  const TW = w + 0.05, TD = depth + 0.05
  const x0 = -0.025, z0 = -0.025
  const baseH = trayH - TRAY_RECESS
  const rimY = baseH + TRAY_RECESS / 2
  // В отражении поддон матовее и полупрозрачен, и обрезан трафаретом пола.
  const acrylic = mirror
    ? <meshPhysicalMaterial color="#f6f5f2" roughness={0.45} metalness={0.02} envMapIntensity={0.4}
        side={THREE.BackSide} ref={m => { if (m) stencilClip(m, 0.3) }} />
    : <meshPhysicalMaterial color="#f6f5f2" roughness={0.12} metalness={0.02}
        clearcoat={0.7} clearcoatRoughness={0.1} envMapIntensity={1.0} />
  const rim = (args: [number, number, number], pos: [number, number, number], key: string) => (
    <RoundedBox key={key} args={args} radius={Math.min(TRAY_RECESS * 0.4, 0.005)} smoothness={3}
      position={pos} castShadow={!mirror} receiveShadow={!mirror}>
      {acrylic}
    </RoundedBox>
  )
  return (
    <group>
      {/* основание; его верх — утопленное поле поддона */}
      <RoundedBox args={[TW, baseH, TD]} radius={Math.min(baseH * 0.3, 0.01)} smoothness={3}
        position={[w / 2, baseH / 2, depth / 2]} castShadow={!mirror} receiveShadow={!mirror}>
        {acrylic}
      </RoundedBox>
      {rim([TW, TRAY_RECESS, TRAY_RIM], [w / 2, rimY, z0 + TRAY_RIM / 2], 'front')}
      {rim([TW, TRAY_RECESS, TRAY_RIM], [w / 2, rimY, z0 + TD - TRAY_RIM / 2], 'back')}
      {rim([TRAY_RIM, TRAY_RECESS, TD - TRAY_RIM * 2], [x0 + TRAY_RIM / 2, rimY, depth / 2], 'left')}
      {rim([TRAY_RIM, TRAY_RECESS, TD - TRAY_RIM * 2], [x0 + TW - TRAY_RIM / 2, rimY, depth / 2], 'right')}
      {/* слив — без него утопленное поле выглядит просто ступенькой */}
      {!mirror && <mesh position={[w / 2, baseH + 0.0008, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.045, 28]} />
        <meshPhysicalMaterial color="#c8ccce" metalness={0.95} roughness={0.25} envMapIntensity={1.2} />
      </mesh>}
    </group>
  )
}

function NicheMesh({ niche }: { niche: Niche }) {
  const { w, depth, wallH, trayH, walls } = niche
  const base = useMemo(() => makeTileMaps(), [])
  // Комната замкнута в УГОЛ. Стены — ТЕ, что объявила раскладка: к ним приходят
  // профили и стёкла, придуманная стена «где красивее» оставила бы профиль
  // висеть в пустоте. Стены, обращённые от камеры, отсекаются самим рендером
  // (плоскость односторонняя), поэтому ближняя обзор не закрывает.
  const WH = wallH + 0.9                    // стены заметно выше кабины
  const EXT = 3.0                           // вынос стен за габарит — угол уходит за кадр
  const FW = w + 7, FD = depth + 7          // пол доходит до камеры и за неё
  const floorMaps = useMemo(() => tiledMaps(base, FW, FD), [base, FW, FD])
  const backMaps = useMemo(() => tiledMaps(base, w + EXT * 2, WH), [base, w, WH, EXT])
  const sideMaps = useMemo(() => tiledMaps(base, depth + EXT * 2, WH), [base, depth, WH, EXT])
  // Рельеф — только по шву (своя карта): раньше рельеф брался с карты цвета, и
  // прожилки камня выдавливались бороздами. Шов ещё и матовее тела плитки.
  const tile = (m: TileMaps) =>
    <meshStandardMaterial map={m.color} bumpMap={m.height} bumpScale={-0.35}
      roughnessMap={m.rough} roughness={0.9} metalness={0.02} envMapIntensity={0.7} />

  return (
    <group>
      {/* большой облицованный пол — полированный керамогранит, слабо зеркалит кабину */}
      <mesh position={[w / 2, 0, depth / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[FW, FD]} />
        {/* Глянцевая плитка (полированный керамогранит): отражение окружения через
            envMap — без off-screen прохода MeshReflectorMaterial, который конфликтовал
            с MeshTransmissionMaterial стекла и давал чёрный артефакт на части GPU. */}
        {/* R3: пол помечает себя в трафарете — отражение потом рисуется ТОЛЬКО там,
            где пол реально виден. Заслонённые поддоном пиксели не проходят тест
            глубины и в трафарет не попадают, поэтому отражение не лезет на поддон. */}
        <meshStandardMaterial map={floorMaps.color} bumpMap={floorMaps.height} bumpScale={-0.25}
          roughnessMap={floorMaps.rough} roughness={0.5} metalness={0.04} envMapIntensity={0.9}
          stencilWrite stencilRef={FLOOR_STENCIL} stencilFunc={THREE.AlwaysStencilFunc}
          stencilZPass={THREE.ReplaceStencilOp} />
      </mesh>
      {walls.back && (
        <mesh position={[w / 2, WH / 2, depth]} rotation={[0, Math.PI, 0]} receiveShadow>
          <planeGeometry args={[w + EXT * 2, WH]} />
          {tile(backMaps)}
        </mesh>
      )}
      {walls.right && (
        <mesh position={[w, WH / 2, depth / 2]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth + EXT * 2, WH]} />
          {tile(sideMaps)}
        </mesh>
      )}
      {walls.left && (
        <mesh position={[0, WH / 2, depth / 2]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
          <planeGeometry args={[depth + EXT * 2, WH]} />
          {tile(sideMaps)}
        </mesh>
      )}
      <Tray w={w} depth={depth} trayH={trayH} />
    </group>
  )
}

// R6 · Накопительный кадр. Пока клиент крутит модель — дешёвый режим: важна
// отзывчивость. Отпустил — сцена «доводится»: растут сэмплы стекла, разрешение
// буфера преломления, плотность пикселей и качество затенения. Именно количество
// сэмплов, а не формулы, отличает каталожный рендер от вида в браузере.
//
// Порог 400 мс: короче — режим дёргается на инерции орбиты, длиннее — читается
// как задержка.
// R7 · Кадр на печать. Постобработка (AO, блики, сглаживание) следует за размером
// рендера, поэтому кадр высокого разрешения снимается временным подъёмом плотности
// пикселей — а не ручным gl.render в обход композитора, который выбросил бы всё,
// ради чего маршрут и делался.
export type CaptureFn = (scale: number) => Promise<string>

// Отдаём функцию съёмки наружу колбэком, а не записью в чужой ref: проп менять
// нельзя, да и владелец ссылки тогда сам решает, где её хранить.
function useSettled(deps: unknown[], delay = 400) {
  // Ключ описывает, ЧТО сейчас в кадре. «Кадр сел» — это не отдельный флаг, а
  // совпадение ключа с тем, для которого таймер успел досчитать: любая смена
  // сцены сбрасывает состояние сама, без setState внутри эффекта.
  const key = JSON.stringify(deps)
  const [settledKey, setSettledKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const arm = useCallback((k: string) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSettledKey(k), delay)
  }, [delay])
  useEffect(() => {
    arm(key)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [key, arm])
  // Движение камеры: обработчик события, не эффект. Повторный null — no-op для React.
  const disturb = useCallback(() => { setSettledKey(null); arm(key) }, [arm, key])
  return { settled: settledKey === key, disturb }
}

function Assembly3D({ assembly, metalMat, glassTint, onPick, pickedKey, pickedRole, settled, mirror }: {
  assembly: Assembly; metalMat: THREE.Material; glassTint: GlassTint
  onPick?: (n: PickedNode) => void; pickedKey?: string | null; pickedRole?: string | null
  settled?: boolean        // кадр «сел»: можно тратиться на сэмплы
  mirror?: boolean         // отражение в полу: дешёвые материалы, обрезка трафаретом
}) {
  const pickable = !!onPick && !mirror
  const lit = (key: string, role: string | null) => key === pickedKey || (!!role && role === pickedRole)
  // Кабина поднята на поддон.
  return (
    <group position={[0, assembly.niche.trayH, 0]}>
      {/* В отражении стекло — дешёвая полупрозрачная плита: второе преломление
          стоило бы ещё одного полного прохода, а в полу его всё равно не разобрать. */}
      {mirror && assembly.glass.map(g => (
        <mesh key={g.key} position={g.pos} rotation={[0, g.rotY, 0]}>
          <boxGeometry args={g.size} />
          <meshPhysicalMaterial color="#eef4f1" roughness={0.25} metalness={0}
            ref={m => { if (m) stencilClip(m, 0.22) }} />
        </mesh>
      ))}
      {!mirror && assembly.glass.map(g => (
        <mesh key={g.key} position={g.pos} rotation={[0, g.rotY, 0]} castShadow renderOrder={2}>
          <boxGeometry args={g.size} />
          {/* Общий сэмплер преломления: у каждого стекла свой off-screen буфер, и при
              нескольких полотнах соседнее попадало в буфер пустым — дверь рисовалась
              белым прямоугольником. Встроенный сэмплер делает один проход на всех. */}
          <MeshTransmissionMaterial
            transmissionSampler
            transmission={0.96}
            thickness={0.008}
            roughness={0.03}
            ior={1.52}
            chromaticAberration={0.02}
            anisotropy={0.04}
            distortion={0}
            temporalDistortion={0}
            samples={settled ? 16 : 4}
            resolution={settled ? 1024 : 256}
            color={glassTint.color}
            attenuationColor={glassTint.attenuation}
            attenuationDistance={glassTint.distance}
            clearcoat={0.9}
            clearcoatRoughness={0.04}
          />
          {/* V2: полированная кромка стекла — тонкая световая линия по рёбрам, читается толщина.
              Цвет и прозрачность — пропсами: Edges это Line2, вложенный материал он игнорирует. */}
          <Edges threshold={15} color="#eaf6ef" lineWidth={1} transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
      {assembly.metal.map(m => {
        const role = nodeRole({ spec: m.spec, metalKind: m.kind })
        return (
          <mesh key={m.key} position={m.pos} rotation={[0, m.rotY, 0]} material={metalMat} castShadow
            onClick={pickable ? (e => { e.stopPropagation(); onPick!({ key: m.key, kind: 'metal', spec: m.spec, role }) }) : undefined}
            onPointerOver={pickable ? (e => { e.stopPropagation(); document.body.style.cursor = 'pointer' }) : undefined}
            onPointerOut={pickable ? (() => { document.body.style.cursor = 'auto' }) : undefined}>
            <boxGeometry args={m.size} />
            {lit(m.key, role) && <Edges scale={1.04} color="#f0a500" lineWidth={2.5} depthTest={false} renderOrder={999} />}
          </mesh>
        )
      })}
      {assembly.hardware.map(h => {
        const role = nodeRole({ spec: h.spec, model: h.model })
        return (
        <group key={h.key} position={h.pos} rotation={[0, h.rotY, 0]}>
          {/* Есть паспорт — рисуем по данным (своя рамка посадки); нет — прежней формой. */}
          {(() => {
            const spec = getPart(h.part)
            return spec
              ? <Part spec={spec} material={metalMat} />
              : <Hardware model={h.model} shape={h.shape} material={metalMat} flatTube={h.flatTube} />
          })()}
          {/* Зона захвата: сама деталь 20–40 мм, мышью в неё не попасть. Невидимая
              сфера ловит клик. Прозрачная, а не visible=false — иначе raycast её минует. */}
          {pickable && (
            <mesh onClick={e => { e.stopPropagation(); onPick!({ key: h.key, kind: 'hardware', spec: h.spec, model: h.model, shape: h.shape, role }) }}
              onPointerOver={e => { e.stopPropagation(); document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { document.body.style.cursor = 'auto' }}>
              <sphereGeometry args={[0.05, 10, 8]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
          {/* маркер выбранного узла — виден сквозь стекло */}
          {lit(h.key, role) && (
            <mesh renderOrder={999}>
              <sphereGeometry args={[0.035, 16, 12]} />
              <meshBasicMaterial color="#f0a500" transparent opacity={0.45} depthTest={false} />
            </mesh>
          )}
        </group>
        )
      })}
    </group>
  )
}

function Studio() {
  return (
    <Environment resolution={512} frames={1}>
      <color attach="background" args={['#d3d7dd']} />
      {/* верхний софт-бокс — основной свет */}
      <Lightformer form="rect" intensity={1.34} position={[0, 5, 1]} rotation={[Math.PI / 2, 0, 0]} scale={[9, 5, 1]} color="#ffffff" />
      {/* боковые заполняющие (холодный слева, тёплый справа) */}
      <Lightformer form="rect" intensity={0.67} position={[-5, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[4, 6, 1]} color="#e6eeff" />
      <Lightformer form="rect" intensity={0.67} position={[5, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 6, 1]} color="#fff1e0" />
      {/* контровой сзади — блики на кромках хрома и стекла */}
      <Lightformer form="rect" intensity={1.01} position={[0, 3, -5]} scale={[7, 4, 1]} color="#ffffff" />
      <Lightformer form="ring" intensity={0.59} position={[3, 2, 4]} scale={2.2} color="#ffffff" />
      {/* V3: вертикальные софт-боксы — вытянутые «студийные» блики-полосы на хроме */}
      <Lightformer form="rect" intensity={1.09} position={[-2.2, 2.5, 3.2]} rotation={[0, 0, 0]} scale={[0.28, 5.5, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={1.01} position={[2.4, 2.5, 3.2]} rotation={[0, 0, 0]} scale={[0.24, 5.5, 1]} color="#f4f8ff" />
      <Lightformer form="rect" intensity={0.92} position={[0.6, 3, 3.6]} rotation={[0, 0, 0]} scale={[0.18, 6, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={0.76} position={[-3.6, 2, 1]} rotation={[0, Math.PI / 3, 0]} scale={[0.2, 5, 1]} color="#eef3ff" />
      {/* V7: градиентная среда — тёплое отражение «от пола» снизу + холодный купол сверху */}
      <Lightformer form="rect" intensity={0.21} position={[0, -1.5, 1.5]} rotation={[-Math.PI / 2, 0, 0]} scale={[10, 10, 1]} color="#ffe8d6" />
      <Lightformer form="ring" intensity={0.21} position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={7} color="#eef4ff" />
    </Environment>
  )
}

export default function Partition3D(
  { model, dims, thickness, finishHex, finishId, glassTint, doorOpen = true, choice, variant, onPick, pickedKey, pickedRole, onCapture }:
  { model: MModel; dims: MDims; thickness: number; finishHex: string; finishId: string; glassTint: GlassTint; doorOpen?: boolean; choice?: HardwareChoice; variant?: MVariant; onPick?: (n: PickedNode) => void; pickedKey?: string | null; pickedRole?: string | null; onCapture?: (fn: CaptureFn | null) => void },
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
  // Металл в отражении: матовее, глуше и обрезан трафаретом пола.
  const mirrorMat = useMemo(() => {
    const m = (metalMat as THREE.MeshPhysicalMaterial).clone()
    m.roughness = Math.min(1, ((metalMat as THREE.MeshPhysicalMaterial).roughness ?? 0.2) + 0.3)
    m.envMapIntensity = 0.35
    m.side = THREE.BackSide          // зеркальное отражение выворачивает грани
    return stencilClip(m, 0.28)
  }, [metalMat])
  const { w, h, d } = assembly.bounds
  const span = Math.max(w, h, d)
  // R1: кадр каталога, а не обзор комнаты. Камера на уровне глаз, объектив ~50 мм
  // (вертикальные 27° при полном кадре), дистанция подобрана так, чтобы изделие
  // держало кадр по высоте. Раньше fov 33 и дистанция 1.7×габарит давали мелкое
  // изделие в пустой комнате.
  const cx = w / 2, cz = d / 2
  const FOV = 30
  const frameH = (h + assembly.niche.trayH) * 1.28          // изделие + воздух сверху и снизу
  const camDist = frameH / 2 / Math.tan((FOV / 2) * Math.PI / 180)
  const ty = assembly.niche.trayH + h * 0.42
  const eye = assembly.niche.trayH + 1.5                     // рост смотрящего
  // Кадр «садится» через 400 мс после последнего движения; смена модели, размеров,
  // стекла или цвета фурнитуры сбрасывает счёт — считать надо заново.
  const { settled, disturb } = useSettled([model.code, dims, glassTint, finishId, doorOpen])
  // R7 · Кадр на печать. Снимаем холст КАК ЕСТЬ, ничего не переключая.
  //
  // Пробовал поднимать разрешение на время съёмки тремя способами — плотностью
  // пикселей через проп, через setDpr и сменой размера холста. Все три снимают
  // кадр крупнее, но НИ ОДИН не возвращает сцену обратно: плотность держит
  // композитор постобработки, и живая сцена остаётся либо вчетверо тяжелее,
  // либо размытой. Ломать рабочую сцену ради кадра нельзя.
  //
  // Поэтому кадр = текущий холст. В покое R6 уже держит двойную плотность, так
  // что на широком окне это 2000+ пикселей по ширине — для КП и каталога хватает.
  // Настоящий офскрин-рендер 2–4K — отдельная работа, записана в маршруте.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const capture = useCallback<CaptureFn>(async () => {
    // дать кадру «сесть»: после клика по кнопке сцена уже не двигалась
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    return canvasRef.current?.toDataURL('image/png') ?? ''
  }, [])
  useEffect(() => {
    onCapture?.(capture)
    return () => onCapture?.(null)
  }, [onCapture, capture])

  return (
    <div className="w-full h-[420px] md:h-[480px] rounded-xl overflow-hidden bg-gradient-to-b from-[#f2f1ee] to-[#e4e2dd]">
      <Canvas
        shadows="soft"
        ref={canvasRef}
        dpr={settled ? [1, 2] : [1, 1.25]}
        style={{ width: '100%', height: '100%', display: 'block' }}
        resize={{ debounce: 0 }}
        // Камера стоит ВНУТРИ комнаты, в её открытом углу (+X / −Z): раскладка ставит
        // изделие в угол стен x=0 и z=depth. Снаружи ближняя стена отсекалась как
        // обратная сторона плоскости, и профиль у стены упирался в белую пустоту.
        camera={{ position: [cx + camDist * 0.46, eye, cz - camDist * 0.9], fov: FOV }}
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.92 }}
        onCreated={onCanvasCreated}
      >
        <Suspense fallback={null}>
          {/* V10: тёплый студийный фон-кадр */}
          <color attach="background" args={['#f0efec']} />
          {/* V6: тёплый ключ + холодное заполнение + контровой; мягкие тени */}
          <ambientLight intensity={0.16} />
          <directionalLight position={[cx - 4.5, ty + 6.5, cz - 5.5]} intensity={1.15} color="#fff4e6" castShadow
            shadow-mapSize={[2048, 2048]} shadow-camera-far={24} shadow-bias={-0.0002} shadow-normalBias={0.02} shadow-radius={5} />
          <directionalLight position={[cx + 5, ty + 3, cz - 1]} intensity={0.38} color="#e6eeff" />
          <directionalLight position={[cx + 1, ty + 4, cz + 6]} intensity={0.26} color="#ffffff" />
          <NicheMesh niche={assembly.niche} />
          <Assembly3D assembly={assembly} metalMat={metalMat} glassTint={glassTint} onPick={onPick} pickedKey={pickedKey} pickedRole={pickedRole} settled={settled} />
          {/* R3 · Отражение в полированном керамограните. Копия сцены, отражённая
              через плоскость пола; видна только внутри трафарета, который пол
              оставил на себе. renderOrder=1 — раньше стекла (2), чтобы отражение
              не легло поверх полотен. */}
          <group scale={[1, -1, 1]} position={[0, -0.0015, 0]} renderOrder={1}>
            <Tray w={assembly.niche.w} depth={assembly.niche.depth} trayH={assembly.niche.trayH} mirror />
            <Assembly3D assembly={assembly} metalMat={mirrorMat} glassTint={glassTint} mirror />
          </group>
          <ContactShadows position={[cx, 0.002, cz]} opacity={0.52} scale={span * 3.2} blur={2.5} far={span * 1.2}
            resolution={settled ? 1024 : 384} frames={settled ? Infinity : 1} />
          <Studio />
          <OrbitControls
            makeDefault
            enablePan={false}
            onChange={disturb}
            minPolarAngle={0.2}
            maxPolarAngle={Math.PI / 2.05}
            minDistance={span * 0.9}
            maxDistance={span * 3.5}
            target={[cx, ty, cz]}
          />
          {/* V1 AO + V8 bloom/виньетка + V9 SMAA — «рендерный» финиш */}
          <EffectComposer enableNormalPass multisampling={0} stencilBuffer>
            <N8AO aoRadius={0.22} distanceFalloff={1} intensity={2.4} halfRes={!settled} quality={settled ? 'high' : 'low'} />
            <Bloom intensity={0.16} luminanceThreshold={0.96} luminanceSmoothing={0.12} mipmapBlur />
            <Vignette offset={0.28} darkness={0.32} />
            <SMAA />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  )
}
