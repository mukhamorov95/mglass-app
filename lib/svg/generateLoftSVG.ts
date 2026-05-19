import type { LoftInputs, LoftSystemType } from '../loftCalculator'
import { getProfileColor, glassToFill, svgDefs, dimH, dimV } from './svgUtils'

export type LoftVisuParams = {
  inputs: LoftInputs
  profileColor?: string   // 'black' | 'chrome' | 'gold' | 'graphite' | 'white'
  doorOpenSide?: 'left' | 'right'
}

export function generateLoftSVG({ inputs, profileColor = 'black', doorOpenSide = 'left' }: LoftVisuParams): string {
  const VW = 500
  const VH = 440

  const PAD_LEFT  = 40
  const PAD_TOP   = 36
  const PAD_RIGHT = 52
  const PAD_BOT   = 56

  const maxW = VW - PAD_LEFT - PAD_RIGHT
  const maxH = VH - PAD_TOP - PAD_BOT

  const w = Math.max(inputs.width  || 2000, 1)
  const h = Math.max(inputs.height || 2400, 1)
  const S = Math.max(1, inputs.sections  || 1)
  const D = Math.max(0, inputs.divisions || 0)
  const rows = D + 1

  const scaleX = maxW / w
  const scaleY = maxH / h
  const scale  = Math.min(scaleX, scaleY)

  const pW = Math.round(w * scale)   // partition width in px
  const pH = Math.round(h * scale)   // partition height in px

  const px = PAD_LEFT + (maxW - pW) / 2   // left edge
  const py = PAD_TOP  + (maxH - pH) / 2   // top edge

  const sectionW = pW / S
  const rowH     = pH / rows

  const pc  = getProfileColor(profileColor)
  const gf  = glassToFill(inputs.glassMaterial?.name ?? '')
  const PW  = 6   // profile stroke width

  const systemType: LoftSystemType = inputs.systemType

  const parts: string[] = []

  // ── Glass fill cells ─────────────────────────────────────────────
  for (let si = 0; si < S; si++) {
    for (let ri = 0; ri < rows; ri++) {
      const cx = px + si * sectionW + PW / 2
      const cy = py + ri * rowH + PW / 2
      const cw = sectionW - PW
      const ch = rowH - PW

      const isDoorCell = (si === 0 && ri === rows - 1 && systemType === 'swing') ||
                         (si <= 1  && ri === rows - 1 && systemType === 'sliding')

      // Slightly different fill for door cells
      const cellFill = isDoorCell
        ? (gf.fill.replace(/[\d.]+\)$/, m => String(parseFloat(m) * 1.7) + ')'))
        : gf.fill

      parts.push(`<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}"
        width="${cw.toFixed(1)}" height="${ch.toFixed(1)}"
        fill="${cellFill}"/>`)

      if (gf.patternId) {
        parts.push(`<rect x="${cx.toFixed(1)}" y="${cy.toFixed(1)}"
          width="${cw.toFixed(1)}" height="${ch.toFixed(1)}"
          fill="url(#${gf.patternId})" opacity="0.65"/>`)
      }
    }
  }

  // ── Outer frame ───────────────────────────────────────────────────
  parts.push(`<rect x="${px}" y="${py}" width="${pW}" height="${pH}"
    fill="none" stroke="${pc.stroke}" stroke-width="${PW}" filter="url(#shadow-soft)"/>`)

  // ── Internal vertical stiles (section dividers) ───────────────────
  for (let si = 1; si < S; si++) {
    const x = px + si * sectionW
    parts.push(`<line x1="${x.toFixed(1)}" y1="${py}" x2="${x.toFixed(1)}" y2="${py + pH}"
      stroke="${pc.stroke}" stroke-width="${PW}"/>`)
  }

  // ── Internal horizontal rails (row dividers) ──────────────────────
  for (let ri = 1; ri < rows; ri++) {
    const y = py + ri * rowH
    parts.push(`<line x1="${px}" y1="${y.toFixed(1)}" x2="${px + pW}" y2="${y.toFixed(1)}"
      stroke="${pc.stroke}" stroke-width="${PW}"/>`)
  }

  // ── Door indicators ───────────────────────────────────────────────
  if (systemType === 'swing') {
    // Door: first section, bottom row (or full height if 1 row)
    const doorRowTop = py + (rows - 1) * rowH
    const doorH = rowH
    const doorW = sectionW

    const hingeX = doorOpenSide === 'left' ? px : px + doorW
    const hingeY = doorRowTop + doorH   // hinge at bottom

    // Door panel outline (slightly highlighted)
    parts.push(`<rect x="${(px + PW / 2).toFixed(1)}" y="${(doorRowTop + PW / 2).toFixed(1)}"
      width="${(doorW - PW).toFixed(1)}" height="${(doorH - PW).toFixed(1)}"
      fill="none" stroke="${pc.stroke}" stroke-width="1.5" stroke-dasharray="4 2" opacity="0.6"/>`)

    // Swing arc
    const arcR = Math.min(doorW, doorH) * 0.95
    let arcSweep: string
    let arcEndX: number
    let arcEndY: number
    let handleX: number

    if (doorOpenSide === 'left') {
      // Hinge on left, door opens right
      arcEndX = hingeX + arcR
      arcEndY = hingeY - arcR
      arcSweep = `M ${hingeX.toFixed(1)},${(hingeY - arcR).toFixed(1)} A ${arcR.toFixed(1)},${arcR.toFixed(1)} 0 0,1 ${arcEndX.toFixed(1)},${hingeY.toFixed(1)}`
      handleX = px + doorW - 5
    } else {
      // Hinge on right, door opens left
      arcEndX = hingeX - arcR
      arcEndY = hingeY - arcR
      arcSweep = `M ${(hingeX - arcR).toFixed(1)},${hingeY.toFixed(1)} A ${arcR.toFixed(1)},${arcR.toFixed(1)} 0 0,1 ${hingeX.toFixed(1)},${(hingeY - arcR).toFixed(1)}`
      handleX = px + 5
    }

    parts.push(`<path d="${arcSweep}" fill="rgba(160,200,240,0.12)"
      stroke="#888" stroke-width="1" stroke-dasharray="5 3"/>`)

    // Diagonal "door in open position"
    parts.push(`<line x1="${hingeX.toFixed(1)}" y1="${hingeY.toFixed(1)}"
      x2="${arcEndX.toFixed(1)}" y2="${arcEndY.toFixed(1)}"
      stroke="${pc.stroke}" stroke-width="2" opacity="0.5"/>`)

    // Handle symbol
    const handleY = doorRowTop + doorH / 2
    parts.push(`<rect x="${(handleX - 2).toFixed(1)}" y="${(handleY - 10).toFixed(1)}"
      width="4" height="20" rx="2" fill="${pc.fill}" stroke="${pc.stroke}" stroke-width="0.8"/>`)

    // Hinge symbols
    const hingePositions = [doorRowTop + doorH * 0.2, doorRowTop + doorH * 0.75]
    for (const hy of hingePositions) {
      parts.push(`<circle cx="${hingeX.toFixed(1)}" cy="${hy.toFixed(1)}"
        r="4" fill="${pc.fill}" stroke="${pc.stroke}" stroke-width="0.8"/>`)
    }
  }

  if (systemType === 'sliding') {
    // Bottom track (double line)
    const trackY = py + pH
    parts.push(`<line x1="${px}" y1="${(trackY + 3).toFixed(1)}" x2="${(px + pW).toFixed(1)}" y2="${(trackY + 3).toFixed(1)}"
      stroke="${pc.stroke}" stroke-width="2.5"/>`)
    parts.push(`<line x1="${px}" y1="${(trackY + 7).toFixed(1)}" x2="${(px + pW).toFixed(1)}" y2="${(trackY + 7).toFixed(1)}"
      stroke="${pc.stroke}" stroke-width="1.2" opacity="0.5"/>`)

    // Top track
    parts.push(`<line x1="${px}" y1="${(py - 3).toFixed(1)}" x2="${(px + pW).toFixed(1)}" y2="${(py - 3).toFixed(1)}"
      stroke="${pc.stroke}" stroke-width="2"/>`)

    // Sliding arrows on first section
    const arrowCx = px + sectionW / 2
    const arrowCy = py + pH / 2
    const aw = Math.min(sectionW * 0.4, 32)
    parts.push(`<text x="${arrowCx.toFixed(1)}" y="${(arrowCy + 5).toFixed(1)}"
      text-anchor="middle" font-family="sans-serif" font-size="${Math.min(20, aw * 0.6).toFixed(0)}"
      fill="${pc.stroke}" opacity="0.5">↔</text>`)
  }

  // ── Dimension lines ───────────────────────────────────────────────
  const dimY   = py + pH + (systemType === 'sliding' ? 18 : 12)
  const dimX   = px + pW + 22
  const wLabel = `${w} мм`
  const hLabel = `${h} мм`

  parts.push(dimH(px, px + pW, dimY, py + pH, wLabel))
  parts.push(dimV(dimX, py, py + pH, px + pW, hLabel))

  // Section width labels (if multiple sections)
  if (S > 1 && S <= 6) {
    const secW = Math.round(w / S)
    for (let si = 0; si < S; si++) {
      const sx = px + si * sectionW + sectionW / 2
      const labelY = py - 10
      parts.push(`<text x="${sx.toFixed(1)}" y="${labelY.toFixed(1)}"
        text-anchor="middle" font-family="monospace" font-size="8" fill="#aaa">${secW}</text>`)
    }
  }

  // ── System type label ─────────────────────────────────────────────
  const sysLabel = systemType === 'swing' ? 'Распашная' : systemType === 'sliding' ? 'Раздвижная' : 'Глухая'
  const capY = VH - 10
  const capText = `${sysLabel} · ${S} секц. · ${inputs.glassMaterial?.name ?? 'стекло'}`
  parts.push(`<text x="${VW / 2}" y="${capY}" text-anchor="middle"
    font-family="sans-serif" font-size="10" fill="#9a9a95">${capText}</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}">
  <defs>${svgDefs()}</defs>
  <rect width="${VW}" height="${VH}" fill="#f7f7f6"/>
  ${parts.join('\n  ')}
</svg>`
}
