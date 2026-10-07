import { createClient } from '@/lib/supabase-browser'
import { saveOrderNotes, type OrderNotesSaved } from '@/lib/b2b/orderNotesClient'
import { toast, sendOrToast, responseError, NETWORK_ERROR } from '@/lib/toast'

export type LaunchInput = { workDate: string; deadline: string | null; customNumber: string | null; drawing: File | null }

// Запуск просчёта в работу — одна реализация для «Просчётов» и карточки сделки (этап 3
// docs/SYSTEM_ORDER_ROUTE.md). Порядок важен: чертёж → дата запуска и номер (сервер собирает
// notes из свежей записи) → задачи цеху. Ошибка любого шага говорится вслух; null — не запущен.
export async function launchOrder(orderId: number, input: LaunchInput): Promise<OrderNotesSaved | null> {
  // Чертёж для цеха: тот же bucket/путь, что «Прикрепить чертёж» в заказах —
  // мастер увидит его в «Моих задачах» и в карточке заказа.
  let drawingUrl: string | null = null
  if (input.drawing) {
    const ext = (input.drawing.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `order-drawings/${orderId}.${ext}`
    const { error } = await createClient().storage.from('b2b-attachments').upload(path, input.drawing, { upsert: true })
    if (error) {
      toast.error('Чертёж не загрузился — заказ не запущен', { detail: `${error.message}. Нажмите «Запустить» ещё раз` })
      return null
    }
    // bucket приватный, publicUrl не работает — храним путь, показ идёт через /api/b2b/drawing
    drawingUrl = path
  }

  // launched_at пишется и колонкой, и в notes, иначе заказ висит «без даты запуска» в /b2b-orders.
  const r = await saveOrderNotes(orderId, {
    action: 'launch', workDate: input.workDate, deadline: input.deadline, drawingUrl,
    customNumber: input.customNumber?.trim() || null,
  })
  if (r.error !== null) {
    toast.error('Заказ не запущен', { detail: `${r.error}. Данные остались в окне — нажмите ещё раз` })
    return null
  }

  // Задачи в цех. Раньше запрос уходил без await и с проглоченной ошибкой — заказ 0928-3
  // провисел 16 дней невидимым для цеха: статус «в работе», а задач ноль.
  const launchUrl = `/api/b2b-orders/${orderId}/launch-production`
  const launched = await fetch(launchUrl, { method: 'POST' }).catch(() => null)
  if (!launched?.ok) {
    // Генерация задач идемпотентна — повтор не задвоит их.
    const retry = async () => {
      const rr = await sendOrToast('Задачи в цех снова не создались', launchUrl, { method: 'POST' }, 'Сообщите разработчику')
      if (rr) toast.success('Задачи в цех созданы', { detail: 'Цех увидит заказ в своих экранах.' })
    }
    toast.error('Заказ запущен, но задачи в цех не создались', {
      detail: `${launched ? await responseError(launched) : NETWORK_ERROR}. Цех его не увидит — повторите или сообщите разработчику.`,
      action: { label: 'Создать задачи ещё раз', onClick: () => { void retry() } },
    })
  }
  return r.data
}
