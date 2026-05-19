import type { MirrorInputs } from '../mirrorCalculator'
import { getProfileColor, svgDefs, dimH, dimV } from './svgUtils'

export function generateMirrorSVG(inputs: MirrorInputs): string {
  const VW = 400
  const VH = 460

  const PAD_H = 48  // horizontal padding
  const PAD_TOP = 32
  const PAD_BOT = 56  // room for dim line + caption
  const PAD_RIGHT = 52 // room for vertical dim line

  const maxW = VW - PAD_H - PAD_RIGHT
  const maxH = VH - PAD_TOP - PAD_BOT

  const w = Math.max(inputs.width || 800, 1)
  const h = Math.max(inputs.height || 800, 1)

  const { shape } = inputs

  const scaleX = maxW / w
  const scaleY = maxH / h
  const scale  = Math.min(scaleX, scaleY)

  let mW = Math.round(w * scale)
  let mH = Math.round(h * scale)
  if (shape === 'circle') { const d = Math.min(mW, mH); mW = d; mH = d }

  const mx = PAD_H + (maxW - mW) / 2
  const my = PAD_TOP + (maxH - mH) / 2

  const cx = mx + mW / 2
  const cy = my + mH / 2

  const pc = getProfileColor(inputs.mirrorFrame?.color)

  const parts: string[] = []

  // ── Glow (hasLighting) ─────────────────────────────────────────────────
  if (inputs.hasLighting) {
    const g = 14
    if (shape === 'circle' || shape === 'oval') {
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${mW / 2 + g}" ry="${mH / 2 + g}"
        fill="rgba(255,240,160,0.22)" stroke="rgba(255,220,80,0.45)" stroke-width="${g}"
        filter="url(#glow-warm)"/>`)
    } else {
      parts.push(`<rect x="${mx - g}" y="${my - g}" width="${mW + g * 2}" height="${mH + g * 2}"
        rx="6" fill="rgba(255,240,160,0.22)" stroke="rgba(255,220,80,0.45)" stroke-width="${g}"
        filter="url(#glow-warm)"/>`)
    }
  }

  // ── Decorative frame (behind mirror) ─────────────────────────────────
  if (inputs.mirrorFrame) {
    const fw = 14
    if (shape === 'circle' || shape === 'oval') {
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${mW / 2 + fw}" ry="${mH / 2 + fw}"
        fill="${pc.fill}" stroke="${pc.stroke}" stroke-width="2" filter="url(#shadow-soft)"/>`)
    } else {
      parts.push(`<rect x="${mx - fw}" y="${my - fw}" width="${mW + fw * 2}" height="${mH + fw * 2}"
        rx="3" fill="${pc.fill}" stroke="${pc.stroke}" stroke-width="2" filter="url(#shadow-soft)"/>`)
    }
  }

  // ── Mirror surface ──────────────────────────────────────────────────
  const mirrorStroke = '#9ba2b0'
  if (shape === 'circle') {
    const r = Math.min(mW, mH) / 2
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}"
      fill="url(#mirror-grad)" stroke="${mirrorStroke}" stroke-width="1.5" filter="url(#shadow-soft)"/>`)
  } else if (shape === 'oval') {
    parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${mW / 2}" ry="${mH / 2}"
      fill="url(#mirror-grad)" stroke="${mirrorStroke}" stroke-width="1.5" filter="url(#shadow-soft)"/>`)
  } else {
    parts.push(`<rect x="${mx}" y="${my}" width="${mW}" height="${mH}"
      fill="url(#mirror-grad)" stroke="${mirrorStroke}" stroke-width="1.5" filter="url(#shadow-soft)"/>`)
  }

  // ── Sandblast overlay ──────────────────────────────────────────────
  if (inputs.hasSandblast) {
    const inset = 0.15
    const sbX = mx + mW * inset
    const sbY = my + mH * inset
    const sbW = mW * (1 - inset * 2)
    const sbH = mH * (1 - inset * 2)
    if (shape === 'circle') {
      const r = Math.min(mW, mH) / 2 * (1 - inset * 2)
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r}" fill="url(#pat-sandblast)" opacity="0.75"/>`)
    } else if (shape === 'oval') {
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${sbW / 2}" ry="${sbH / 2}" fill="url(#pat-sandblast)" opacity="0.75"/>`)
    } else {
      parts.push(`<rect x="${sbX.toFixed(1)}" y="${sbY.toFixed(1)}" width="${sbW.toFixed(1)}" height="${sbH.toFixed(1)}"
        fill="url(#pat-sandblast)" opacity="0.75"/>`)
    }
  }

  // ── Facet line ────────────────────────────────────────────────────
  if (inputs.hasFacet && shape === 'rectangle') {
    const fi = Math.max(8, mW * 0.04)
    parts.push(`<rect x="${(mx + fi).toFixed(1)}" y="${(my + fi).toFixed(1)}"
      width="${(mW - fi * 2).toFixed(1)}" height="${(mH - fi * 2).toFixed(1)}"
      fill="none" stroke="#8a9ab0" stroke-width="1.2" stroke-dasharray="5 3" opacity="0.6"/>`)
    parts.push(`<text x="${cx}" y="${my + mH - fi / 2 - 1}" text-anchor="middle"
      font-family="sans-serif" font-size="8" fill="#7a8a9a" opacity="0.8">фацет ${inputs.facetTypeMm ?? ''}мм</text>`)
  }

  // ── Highlight (glass reflection) ─────────────────────────────────
  const hlX = mx + mW * 0.07
  const hlY = my + mH * 0.06
  const hlW = mW * 0.10
  const hlH = mH * 0.50
  parts.push(`<rect x="${hlX.toFixed(1)}" y="${hlY.toFixed(1)}" width="${hlW.toFixed(1)}" height="${hlH.toFixed(1)}"
    fill="white" opacity="0.22" rx="3"/>`)

  // ── Button indicator ──────────────────────────────────────────────
  if (inputs.buttonType !== 'none') {
    const bx = mx + mW - 12
    const by = my + mH - 12
    const label = inputs.buttonType === 'sensor' ? 'S' : '~'
    const bColor = '#555'
    parts.push(`<circle cx="${bx}" cy="${by}" r="8" fill="${bColor}" stroke="#aaa" stroke-width="1.2" opacity="0.85"/>`)
    parts.push(`<text x="${bx}" y="${by + 3.5}" text-anchor="middle" font-family="sans-serif"
      font-size="8" font-weight="bold" fill="white">${label}</text>`)
  }

  // ── Lighting label ────────────────────────────────────────────────
  if (inputs.hasLighting) {
    parts.push(`<text x="${cx}" y="${my - 12}" text-anchor="middle"
      font-family="sans-serif" font-size="9" fill="#b89820" opacity="0.9">✦ подсветка по периметру</text>`)
  }

  // ── Dimension lines ───────────────────────────────────────────────
  const dimY    = my + mH + 20
  const dimX    = mx + mW + 22
  const wLabel  = `${w} мм`
  const hLabel  = `${h} мм`

  parts.push(dimH(mx, mx + mW, dimY, my + mH, wLabel))
  parts.push(dimV(dimX, my, my + mH, mx + mW, hLabel))

  // ── Caption ───────────────────────────────────────────────────────
  const capName = inputs.mirrorMaterial?.name ?? 'Зеркало'
  const capY = VH - 10
  parts.push(`<text x="${VW / 2}" y="${capY}" text-anchor="middle"
    font-family="sans-serif" font-size="10" fill="#9a9a95">${capName}</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}">
  <defs>${svgDefs()}</defs>
  <rect width="${VW}" height="${VH}" fill="#f7f7f6"/>
  ${parts.join('\n  ')}
</svg>`
}
