import { toast } from '@/lib/toast'
import { promptDialog } from '@/lib/dialog'

// «Скопировано» — только когда буфер принял текст (#886). Отказал — окно с выделенным
// текстом, чтобы человек скопировал руками, а не отправил клиенту пустоту.
export async function copyOrShow(text: string, opts: { ok: string; title: string; detail?: string }): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    await promptDialog({
      title: opts.title,
      text: 'Буфер обмена недоступен — текст выделен, скопируйте его (⌘C / Ctrl+C).',
      defaultValue: text, multiline: text.includes('\n'), confirmLabel: 'Готово',
    })
    return false
  }
  toast.success(opts.ok, opts.detail ? { detail: opts.detail } : undefined)
  return true
}
