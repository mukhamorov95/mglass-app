export const PROFILE_COLORS: Record<string, { stroke: string; fill: string }> = {
  black:    { stroke: '#1a1a1a', fill: '#2a2a2a' },
  chrome:   { stroke: '#b8bec7', fill: '#d0d5dd' },
  gold:     { stroke: '#c9a84c', fill: '#d4b860' },
  graphite: { stroke: '#4a4a4a', fill: '#5c5c5c' },
  white:    { stroke: '#c0c0c0', fill: '#e8e8e8' },
  brush:    { stroke: '#8a8a8a', fill: '#a0a0a0' },
}

export function getProfileColor(color?: string | null): { stroke: string; fill: string } {
  return PROFILE_COLORS[color ?? 'black'] ?? PROFILE_COLORS.black
}

export function glassToFill(name: string): { fill: string; patternId?: string } {
  const n = (name ?? '').toLowerCase()
  if (n.includes('бронз'))                                          return { fill: 'rgba(180,150,100,0.22)' }
  if (n.includes('графит'))                                         return { fill: 'rgba(80,80,80,0.22)' }
  if (n.includes('матов') || n.includes('матель') || n.includes('matelux') || n.includes('moru'))
                                                                    return { fill: 'rgba(215,220,228,0.40)', patternId: 'pat-frosted' }
  if (n.includes('рифл'))                                          return { fill: 'rgba(210,225,240,0.25)', patternId: 'pat-ribbed-v' }
  if (n.includes('аквал'))                                         return { fill: 'rgba(180,220,240,0.30)' }
  if (n.includes('осветл') || n.includes('crystal'))               return { fill: 'rgba(210,230,248,0.22)' }
  return { fill: 'rgba(200,220,240,0.20)' }
}

export function svgDefs(): string {
  return `
  <linearGradient id="mirror-grad" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%"   stop-color="#d4d9e4"/>
    <stop offset="30%"  stop-color="#e8eaef"/>
    <stop offset="60%"  stop-color="#dde0e8"/>
    <stop offset="100%" stop-color="#c4c8d2"/>
  </linearGradient>
  <pattern id="pat-frosted" width="4" height="4" patternUnits="userSpaceOnUse">
    <rect width="4" height="4" fill="none"/>
    <circle cx="1" cy="1" r="0.8" fill="#fff" opacity="0.45"/>
    <circle cx="3" cy="3" r="0.8" fill="#fff" opacity="0.45"/>
    <circle cx="1" cy="3" r="0.5" fill="#fff" opacity="0.25"/>
  </pattern>
  <pattern id="pat-ribbed-v" width="5" height="1" patternUnits="userSpaceOnUse">
    <rect x="0" y="0" width="1.5" height="1" fill="rgba(255,255,255,0.55)"/>
  </pattern>
  <pattern id="pat-sandblast" width="3" height="3" patternUnits="userSpaceOnUse">
    <rect x="0" y="0" width="3" height="1.2" fill="rgba(255,255,255,0.30)"/>
  </pattern>
  <marker id="arr-end" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
    <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="#888"/>
  </marker>
  <marker id="arr-start" markerWidth="7" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
    <path d="M0,0.5 L6,3.5 L0,6.5 Z" fill="#888"/>
  </marker>
  <filter id="glow-warm" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur stdDeviation="7" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="shadow-soft" x="-10%" y="-10%" width="120%" height="120%">
    <feDropShadow dx="2" dy="3" stdDeviation="4" flood-color="rgba(0,0,0,0.18)"/>
  </filter>
  `
}

export function dimH(x1: number, x2: number, y: number, refY: number, label: string): string {
  const mx = (x1 + x2) / 2
  return `
  <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#999" stroke-width="0.9"
    marker-start="url(#arr-start)" marker-end="url(#arr-end)"/>
  <line x1="${x1}" y1="${Math.min(y, refY) - 1}" x2="${x1}" y2="${Math.max(y, refY) + 1}"
    stroke="#ccc" stroke-width="0.6"/>
  <line x1="${x2}" y1="${Math.min(y, refY) - 1}" x2="${x2}" y2="${Math.max(y, refY) + 1}"
    stroke="#ccc" stroke-width="0.6"/>
  <rect x="${mx - 24}" y="${y - 8}" width="48" height="14" rx="2" fill="white" opacity="0.92"/>
  <text x="${mx}" y="${y + 2}" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">${label}</text>
  `
}

export function dimV(x: number, y1: number, y2: number, refX: number, label: string): string {
  const my = (y1 + y2) / 2
  return `
  <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#999" stroke-width="0.9"
    marker-start="url(#arr-start)" marker-end="url(#arr-end)"/>
  <line x1="${Math.min(x, refX) - 1}" y1="${y1}" x2="${Math.max(x, refX) + 1}" y2="${y1}"
    stroke="#ccc" stroke-width="0.6"/>
  <line x1="${Math.min(x, refX) - 1}" y1="${y2}" x2="${Math.max(x, refX) + 1}" y2="${y2}"
    stroke="#ccc" stroke-width="0.6"/>
  <rect x="${x - 24}" y="${my - 8}" width="48" height="14" rx="2" fill="white" opacity="0.92"/>
  <text x="${x}" y="${my + 2}" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">${label}</text>
  `
}
