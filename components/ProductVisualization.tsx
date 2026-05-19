'use client'

import { useCallback, useRef, useState } from 'react'
import type { MirrorInputs } from '@/lib/mirrorCalculator'
import type { LoftInputs }   from '@/lib/loftCalculator'
import { generateMirrorSVG } from '@/lib/svg/generateMirrorSVG'
import { generateLoftSVG }   from '@/lib/svg/generateLoftSVG'

type Props =
  | { type: 'mirror'; inputs: MirrorInputs;       role: string | null; profileColor?: never }
  | { type: 'loft';   inputs: LoftInputs;          role: string | null; profileColor?: string }

export default function ProductVisualization({ type, inputs, role, profileColor }: Props) {
  const [fullscreen, setFullscreen] = useState(false)
  const [collapsed, setCollapsed]   = useState(false)
  const [downloading, setDownloading] = useState(false)

  const svgRef = useRef<HTMLDivElement>(null)

  if (role !== 'admin' && role !== 'ceo') return null

  let svgString = ''
  try {
    if (type === 'mirror') {
      svgString = generateMirrorSVG(inputs as MirrorInputs)
    } else {
      svgString = generateLoftSVG({ inputs: inputs as LoftInputs, profileColor: profileColor ?? 'black' })
    }
  } catch { return null }

  if (!svgString) return null

  // ── PNG export ──────────────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    setDownloading(true)
    try {
      const svgEl = svgRef.current?.querySelector('svg')
      if (!svgEl) return

      const svgData  = new XMLSerializer().serializeToString(svgEl)
      const blob     = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' })
      const url      = URL.createObjectURL(blob)
      const img      = new Image()

      await new Promise<void>((res, rej) => {
        img.onload  = () => res()
        img.onerror = rej
        img.src     = url
      })

      const scale  = 2
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth  * scale
      canvas.height = img.naturalHeight * scale
      const ctx = canvas.getContext('2d')!
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)

      const wi = type === 'mirror' ? (inputs as MirrorInputs).width  : (inputs as LoftInputs).width
      const hi = type === 'mirror' ? (inputs as MirrorInputs).height : (inputs as LoftInputs).height
      const a  = document.createElement('a')
      a.download = `mglass-${type}-${wi}x${hi}.png`
      a.href     = canvas.toDataURL('image/png')
      a.click()
    } finally {
      setDownloading(false)
    }
  }, [type, inputs])

  // ── Inline preview ──────────────────────────────────────────────────────
  const Preview = (
    <div ref={svgRef} className="w-full"
      dangerouslySetInnerHTML={{ __html: svgString }}
      style={{ lineHeight: 0 }}
    />
  )

  return (
    <>
      <div className="bg-white rounded-xl border border-[#e8e8e5] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#f2f2f0]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[#4b4b47]">Предпросмотр</span>
            <span className="text-[9px] font-semibold text-amber-600 bg-amber-50 border border-amber-200
              px-1.5 py-0.5 rounded-full uppercase tracking-wide">admin</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="text-[10px] text-[#9a9a95] hover:text-[#111110] px-2 py-1 rounded
                hover:bg-[#f5f5f3] transition-colors disabled:opacity-40"
              title="Скачать PNG">
              {downloading ? '...' : '↓ PNG'}
            </button>
            <button
              onClick={() => setFullscreen(true)}
              className="text-[10px] text-[#9a9a95] hover:text-[#111110] px-2 py-1 rounded
                hover:bg-[#f5f5f3] transition-colors"
              title="На весь экран">
              ⛶
            </button>
            <button
              onClick={() => setCollapsed(v => !v)}
              className="text-[10px] text-[#9a9a95] hover:text-[#111110] px-2 py-1 rounded
                hover:bg-[#f5f5f3] transition-colors"
              title={collapsed ? 'Развернуть' : 'Свернуть'}>
              {collapsed ? '▼' : '▲'}
            </button>
          </div>
        </div>

        {/* SVG preview */}
        {!collapsed && (
          <div className="p-2 bg-[#fafaf9]">
            {Preview}
          </div>
        )}
      </div>

      {/* Fullscreen modal */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-[999] bg-black/60 flex items-center justify-center p-6"
          onClick={() => setFullscreen(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl overflow-hidden max-w-2xl w-full"
            onClick={e => e.stopPropagation()}>

            <div className="flex items-center justify-between px-4 py-3 border-b border-[#f2f2f0]">
              <span className="text-sm font-semibold text-[#111110]">Предпросмотр изделия</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="text-xs text-[#4b4b47] hover:text-[#111110] px-3 py-1.5 rounded-lg
                    border border-[#e8e8e5] hover:bg-[#f5f5f3] transition-colors disabled:opacity-40">
                  {downloading ? 'Подготовка...' : '↓ Скачать PNG'}
                </button>
                <button
                  onClick={() => setFullscreen(false)}
                  className="w-7 h-7 flex items-center justify-center rounded-lg
                    text-[#9a9a95] hover:text-[#111110] hover:bg-[#f5f5f3] transition-colors text-lg leading-none">
                  ×
                </button>
              </div>
            </div>

            <div className="p-4 bg-[#fafaf9]">
              <div dangerouslySetInnerHTML={{ __html: svgString }} style={{ lineHeight: 0 }} />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
