// Свои окна вместо window.confirm/prompt. Запрос уходит событием, <DialogHost />
// подтверждает приём (ack) и потом отвечает через answerDialog(id, value).
// Нет хоста (страница вне корневого layout, сбой гидрации) — нативное окно,
// чтобы действие не зависло навсегда.

export type ConfirmOptions = {
  title: string
  text?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
export type PromptOptions = {
  title: string
  text?: string
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  multiline?: boolean
}
export type DialogRequest =
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'prompt' } & PromptOptions)
export type DialogEventDetail = DialogRequest & { id: number; ack: () => void }

export const DIALOG_EVENT = 'mg:dialog'
export const HOST_WAIT_MS = 100

const pending = new Map<number, (value: boolean | string | null) => void>()
let seq = 0

export function pendingDialogCount(): number {
  return pending.size
}

// Хост отвечает: confirm → true/false, prompt → строка или null (отмена).
export function answerDialog(id: number, value: boolean | string | null): void {
  const resolve = pending.get(id)
  if (!resolve) return
  pending.delete(id)
  resolve(value)
}

function nativeFallback(req: DialogRequest): boolean | string | null {
  const message = req.text ? `${req.title}\n\n${req.text}` : req.title
  if (req.kind === 'confirm') return window.confirm(message)
  return window.prompt(message, req.defaultValue ?? '')
}

function request(req: DialogRequest): Promise<boolean | string | null> {
  if (typeof window === 'undefined') return Promise.resolve(req.kind === 'confirm' ? false : null)
  return new Promise(resolve => {
    const id = ++seq
    let acked = false
    pending.set(id, resolve)
    const send = () => {
      const detail: DialogEventDetail = { ...req, id, ack: () => { acked = true } }
      window.dispatchEvent(new CustomEvent<DialogEventDetail>(DIALOG_EVENT, { detail }))
    }
    send()
    if (acked) return
    // Хост мог смонтироваться чуть позже первого события — даём ему одну попытку.
    setTimeout(() => {
      if (!pending.has(id)) return
      send()
      if (acked) return
      pending.delete(id)
      resolve(nativeFallback(req))
    }, HOST_WAIT_MS)
  })
}

export async function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return (await request({ kind: 'confirm', ...opts })) === true
}

export async function promptDialog(opts: PromptOptions): Promise<string | null> {
  const v = await request({ kind: 'prompt', ...opts })
  return typeof v === 'string' ? v : null
}
