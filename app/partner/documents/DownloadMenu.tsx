'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from '@/lib/toast'
import { DL_MSG, type DlMessage } from '@/lib/partner/docDownload'

// «⬇» в строке «Документов» (Шовер Гласс 25.11): выбрать КП / Счёт / УПД — и файл скачан, без
// перехода на страницу документа. Документ собирается в скрытом окне той же страницей, что
// открывается по ссылке, поэтому PDF тот же самый.

export type DlItem = { label: string; href: string }

const TIMEOUT_MS = 60_000

export default function DownloadMenu({ items }: { items: DlItem[] }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function fetchDoc(it: DlItem) {
    setOpen(false)
    setBusy(it.label)
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.tabIndex = -1
    // Не display:none: документ должен разложиться в настоящую ширину, иначе снимок пустой.
    Object.assign(frame.style, { position: 'fixed', left: '-20000px', top: '0', width: '1280px', height: '1800px', border: '0' })
    const finish = () => {
      window.removeEventListener('message', onMsg)
      clearTimeout(timer)
      frame.remove()
      setBusy(null)
    }
    const fail = (detail: string) => {
      finish()
      toast.error(`${it.label} не скачан`, { detail: `${detail}. Откройте документ ссылкой рядом и нажмите «Скачать PDF».` })
    }
    function onMsg(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== frame.contentWindow) return
      const m = e.data as DlMessage
      if (m?.type !== DL_MSG) return
      if (m.error || !m.blob) { fail(m.error || 'Документ не собрался'); return }
      const url = URL.createObjectURL(m.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = m.name || 'документ.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
      finish()
    }
    const timer = setTimeout(() => fail('Документ не ответил за минуту'), TIMEOUT_MS)
    window.addEventListener('message', onMsg)
    frame.src = `${it.href}${it.href.includes('?') ? '&' : '?'}dl=1`
    document.body.appendChild(frame)
  }

  if (items.length === 0) return null
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button type="button" className="dl" disabled={busy !== null} aria-haspopup="menu" aria-expanded={open}
        onClick={() => (items.length === 1 ? fetchDoc(items[0]) : setOpen(v => !v))}
        title="Скачать PDF" style={{ cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? `Скачиваю ${busy}…` : items.length === 1 ? `⬇ ${items[0].label} PDF` : '⬇ Скачать'}
      </button>
      {open && (
        <div role="menu" style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 20, minWidth: 150, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.12)', padding: 4 }}>
          {items.map(it => (
            <button key={it.href} type="button" role="menuitem" onClick={() => fetchDoc(it)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', border: 0, background: 'transparent', borderRadius: 7, fontSize: 13.5, color: 'var(--ink)', fontFamily: 'inherit', cursor: 'pointer' }}>
              {it.label} — PDF
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
