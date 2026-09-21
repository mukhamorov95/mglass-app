// Исходный файл КП — старое предложение, из которого собрано наше.
// Лежит в приватном бакете kp-sources; путь начинается с id того, кто загрузил,
// чтобы до сохранения КП человек видел свой файл, а чужой — нет.

export type KpSourceFile = { path: string; name: string; size?: number; type?: string }

// Имя файла показываем человеку, поэтому оставляем как есть, только подрезаем
// и убираем то, чем можно сломать разметку или увести взгляд.
export function safeFileName(name: string): string {
  const clean = String(name ?? '').replace(/[\r\n\t<>"]/g, ' ').replace(/\s+/g, ' ').trim()
  return (clean || 'файл').slice(0, 120)
}

export function fileExt(name: string, fallback = 'pdf'): string {
  const ext = String(name ?? '').split('.').pop() ?? ''
  const clean = ext.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return clean && clean.length <= 5 ? clean : fallback
}

export function sourcePath(userId: string, fileName: string, token: string): string {
  return `${userId}/${token}.${fileExt(fileName)}`
}

// Свой ли это файл. Сравниваем по сегменту пути целиком: префиксное сравнение
// строкой пустило бы чужой «<id>-другой/...», а «..» — вверх по бакету.
export function isOwnSourcePath(path: string, userId: string): boolean {
  if (!path || !userId || path.includes('..')) return false
  const [head, ...rest] = path.split('/')
  return head === userId && rest.length > 0 && rest.every(Boolean)
}
