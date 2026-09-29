'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { DIALOG_EVENT, answerDialog, type DialogEventDetail, type DialogRequest } from '@/lib/dialog'

type Req = DialogRequest & { id: number }

const FOCUSABLE = 'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'

export default function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([])

  useEffect(() => {
    const onDialog = (e: Event) => {
      const d = (e as CustomEvent<DialogEventDetail>).detail
      if (!d || typeof d.id !== 'number') return
      const { ack, ...req } = d
      ack()
      setQueue(q => (q.some(x => x.id === req.id) ? q : [...q, req as Req]))
    }
    window.addEventListener(DIALOG_EVENT, onDialog)
    return () => window.removeEventListener(DIALOG_EVENT, onDialog)
  }, [])

  const current = queue[0]
  if (!current) return null

  const close = (value: boolean | string | null) => {
    answerDialog(current.id, value)
    setQueue(q => q.slice(1))
  }

  return <DialogView key={current.id} req={current} onClose={close} />
}

function DialogView({ req, onClose }: { req: Req; onClose: (value: boolean | string | null) => void }) {
  const [value, setValue] = useState(req.kind === 'prompt' ? (req.defaultValue ?? '') : '')
  const panelRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null)
  const titleId = useId()

  const isPrompt = req.kind === 'prompt'
  const danger = req.kind === 'confirm' && req.danger
  const multiline = req.kind === 'prompt' && req.multiline

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    if (isPrompt && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    } else {
      primaryRef.current?.focus()
    }
    return () => { prev?.focus?.() }
  }, [isPrompt])

  const confirm = () => onClose(isPrompt ? value : true)
  const cancel = () => onClose(isPrompt ? null : false)

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return }
    if (e.key === 'Enter') {
      // В многострочном поле Enter — перенос строки, подтверждение — Ctrl/⌘+Enter.
      const inTextarea = (e.target as HTMLElement).tagName === 'TEXTAREA'
      const onCancelBtn = (e.target as HTMLElement).dataset.role === 'cancel'
      if (onCancelBtn) return
      if (inTextarea && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      confirm()
      return
    }
    if (e.key === 'Tab' && panelRef.current) {
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(n => !n.hasAttribute('disabled'))
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  const confirmLabel = req.confirmLabel ?? (isPrompt ? 'Готово' : 'Подтвердить')
  const cancelLabel = req.kind === 'confirm' ? (req.cancelLabel ?? 'Отмена') : 'Отмена'
  const fieldCls = 'w-full border border-[#e4e4e0] rounded-lg px-3 py-2 text-[13px] text-[#111110] outline-none focus:border-[#111110]'

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-[#111110]/30 transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none"
      onMouseDown={e => { if (e.target === e.currentTarget) cancel() }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}
        className="w-full max-w-md bg-white border border-[#e4e4e0] rounded-2xl shadow-[0_16px_48px_rgba(17,17,16,0.18)] px-5 py-4">
        <h2 id={titleId} className="text-[15px] font-semibold text-[#111110] leading-snug">{req.title}</h2>
        {req.text && <p className="text-[13px] text-[#6b6b66] mt-1.5 leading-relaxed whitespace-pre-wrap">{req.text}</p>}

        {req.kind === 'prompt' && (
          <div className="mt-3">
            {req.label && <label className="block text-[11px] text-[#9a9a95] mb-1">{req.label}</label>}
            {multiline ? (
              <textarea ref={inputRef} value={value} onChange={e => setValue(e.target.value)} placeholder={req.placeholder}
                rows={6} className={`${fieldCls} resize-y font-mono text-[12px]`} />
            ) : (
              <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)} placeholder={req.placeholder}
                className={fieldCls} />
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button data-role="cancel" onClick={cancel}
            className="text-[13px] font-medium px-4 py-2 rounded-lg border border-[#e4e4e0] text-[#111110] hover:bg-[#f0f0ec]">
            {cancelLabel}
          </button>
          <button ref={primaryRef} onClick={confirm}
            className={`text-[13px] font-semibold px-4 py-2 rounded-lg text-white ${danger ? 'bg-[#c23a2b] hover:bg-[#a83225]' : 'bg-[#111110] hover:bg-[#2a2a28]'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
