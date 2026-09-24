// Запрещённый политикой UPDATE/DELETE не даёт ошибку — RLS молча отбирает 0 строк
// (замер ролями 23.09.2026). Поэтому запись зовут с .select('id') и судят по строкам.

export type WriteResult = { data: unknown[] | null; error: { message: string } | null }

export const NOT_SAVED_NO_RIGHTS = 'Не сохранено: нет прав на правку'
export const NOT_DELETED_NO_RIGHTS = 'Не удалено: нет прав на удаление'

// null — строка записана; иначе текст для человека. Только для записи по ключу,
// где ноль строк означает отказ, а не «нечего было менять».
export function writeFailure(res: WriteResult, kind: 'save' | 'delete' = 'save'): string | null {
  if (res.error) return `${kind === 'delete' ? 'Не удалено' : 'Не сохранено'}: ${res.error.message}`
  if (!res.data?.length) return kind === 'delete' ? NOT_DELETED_NO_RIGHTS : NOT_SAVED_NO_RIGHTS
  return null
}
