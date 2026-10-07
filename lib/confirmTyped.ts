import { promptDialog } from '@/lib/dialog'

// Необратимое удаление — только после того, как человек сам наберёт слово или число:
// «ОК» в окне подтверждения нажимают по привычке, а набрать «3» не читая — нельзя.

export type TypedAnswer = 'ok' | 'cancel' | 'mismatch'

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').replace(/ё/gi, 'е').toLowerCase()

export function typedMatches(input: string | null, expected: string): boolean {
  return input != null && norm(input) !== '' && norm(input) === norm(expected)
}

export async function confirmTyped(opts: { title: string; text: string; expected: string; confirmLabel?: string }): Promise<TypedAnswer> {
  const v = await promptDialog({
    title: opts.title,
    text: opts.text,
    label: `Чтобы подтвердить, введите: ${opts.expected}`,
    placeholder: opts.expected,
    confirmLabel: opts.confirmLabel ?? 'Удалить навсегда',
  })
  if (v == null) return 'cancel'
  return typedMatches(v, opts.expected) ? 'ok' : 'mismatch'
}
