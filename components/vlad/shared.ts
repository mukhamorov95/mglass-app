// Общие типы и словари личного контура /vlad.

export type VladTask = {
  id: number
  role: string
  kind: string
  title: string
  details: string | null
  due_date: string | null
  contact: string | null
  steps: { text: string; done: boolean }[]
  status: 'inbox' | 'active' | 'done' | 'dropped'
  created_at: string
}

export const ROLE_META: Record<string, { label: string; icon: string }> = {
  ceo:        { label: 'CEO',          icon: '👑' },
  manager:    { label: 'Менеджер',     icon: '📞' },
  cfo:        { label: 'Финансы',      icon: '💰' },
  production: { label: 'Производство', icon: '🏭' },
  father:     { label: 'Отец',         icon: '👨‍👧' },
  husband:    { label: 'Муж',          icon: '💍' },
  son:        { label: 'Сын',          icon: '👨‍👦' },
  brother:    { label: 'Брат',         icon: '🤝' },
  other:      { label: 'Личное',       icon: '📌' },
}

export const KIND_META: Record<string, { label: string; cls: string }> = {
  task:       { label: 'Сделать',  cls: 'bg-blue-50 text-blue-700' },
  decide:     { label: 'Решить',   cls: 'bg-amber-50 text-amber-700' },
  think:      { label: 'Обдумать', cls: 'bg-purple-50 text-purple-700' },
  commitment: { label: 'Обещал',   cls: 'bg-red-50 text-red-700' },
}

export const fmtDay = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export async function patchTask(id: number, patch: Record<string, unknown>) {
  const r = await fetch('/api/vlad/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) })
  return r.ok
}
