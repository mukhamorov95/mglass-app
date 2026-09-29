import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toast, TOAST_EVENT, responseError, type ToastPayload } from '@/lib/toast'
import {
  confirmDialog, promptDialog, answerDialog, pendingDialogCount,
  DIALOG_EVENT, HOST_WAIT_MS, type DialogEventDetail,
} from '@/lib/dialog'

// Среда тестов — node, без jsdom: окно — это EventTarget с заглушками
// нативных confirm/prompt. Проверяем то, что не зависит от React.
type FakeWindow = EventTarget & { confirm: ReturnType<typeof vi.fn>; prompt: ReturnType<typeof vi.fn> }
const g = globalThis as unknown as { window?: FakeWindow }

function installWindow(): FakeWindow {
  const w = Object.assign(new EventTarget(), { confirm: vi.fn(() => true), prompt: vi.fn(() => 'из нативного') })
  g.window = w
  return w
}

// Хост как в DialogHost: подтверждает приём и складывает запросы в очередь.
function mountHost(w: FakeWindow) {
  const seen: Omit<DialogEventDetail, 'ack'>[] = []
  const onDialog = (e: Event) => {
    const d = (e as CustomEvent<DialogEventDetail>).detail
    d.ack()
    const { ack: _ack, ...req } = d
    void _ack
    seen.push(req)
  }
  w.addEventListener(DIALOG_EVENT, onDialog)
  return { seen, unmount: () => w.removeEventListener(DIALOG_EVENT, onDialog) }
}

beforeEach(() => { installWindow() })
afterEach(() => { delete g.window; vi.useRealTimers() })

describe('toast — событие mg:toast', () => {
  it('несёт вид, заголовок, пояснение и действие', () => {
    const got: ToastPayload[] = []
    g.window!.addEventListener(TOAST_EVENT, e => got.push((e as CustomEvent<ToastPayload>).detail))
    const onClick = () => {}
    toast.error('Оплата не записана', { detail: 'Сервер не ответил', action: { label: 'Повторить', onClick } })
    toast.success('Сохранено')
    toast.info('Подсказка', { durationMs: 8000 })

    expect(got).toHaveLength(3)
    expect(got[0]).toMatchObject({ kind: 'error', title: 'Оплата не записана', detail: 'Сервер не ответил' })
    expect(got[0].action?.label).toBe('Повторить')
    expect(got[1]).toMatchObject({ kind: 'success', title: 'Сохранено' })
    expect(got[2]).toMatchObject({ kind: 'info', durationMs: 8000 })
    expect(new Set(got.map(t => t.id)).size).toBe(3)
  })

  it('на сервере (нет window) молчит и не падает', () => {
    delete g.window
    expect(() => toast.error('x')).not.toThrow()
  })
})

describe('responseError — причина словами', () => {
  it('берёт { error } из ответа', async () => {
    const r = new Response(JSON.stringify({ error: 'Сумма больше остатка' }), { status: 400 })
    expect(await responseError(r)).toBe('Сумма больше остатка')
    expect(await r.json()).toEqual({ error: 'Сумма больше остатка' })
  })
  it('без тела — по коду ответа', async () => {
    expect(await responseError(new Response('oops', { status: 502 }))).toBe('Ошибка сервера (502)')
    expect(await responseError(new Response(null, { status: 403 }))).toBe('Нет прав на это действие')
  })
})

describe('confirmDialog / promptDialog — через хост', () => {
  it('хост получает запрос с id и отвечает — промис разрешается его ответом', async () => {
    const host = mountHost(g.window!)
    const p = confirmDialog({ title: 'Отменить счёт?', danger: true, confirmLabel: 'Отменить счёт' })
    expect(host.seen).toHaveLength(1)
    expect(host.seen[0]).toMatchObject({ kind: 'confirm', title: 'Отменить счёт?', danger: true })
    answerDialog(host.seen[0].id, true)
    await expect(p).resolves.toBe(true)
    expect(g.window!.confirm).not.toHaveBeenCalled()
    host.unmount()
  })

  it('очередь: каждый ответ находит свой промис, в любом порядке', async () => {
    const host = mountHost(g.window!)
    const a = confirmDialog({ title: 'Первый' })
    const b = promptDialog({ title: 'Второй', defaultValue: 'адрес' })
    const c = promptDialog({ title: 'Третий' })
    expect(pendingDialogCount()).toBe(3)
    const [ra, rb, rc] = host.seen
    expect(rb).toMatchObject({ kind: 'prompt', defaultValue: 'адрес' })

    answerDialog(rb.id, 'Мытищи, 1-й Силикатный')
    answerDialog(rc.id, null)
    answerDialog(ra.id, false)
    answerDialog(ra.id, true) // повторный ответ игнорируется

    await expect(a).resolves.toBe(false)
    await expect(b).resolves.toBe('Мытищи, 1-й Силикатный')
    await expect(c).resolves.toBeNull()
    expect(pendingDialogCount()).toBe(0)
    host.unmount()
  })

  it('хост смонтировался после первого события — повторная отправка до него доходит', async () => {
    vi.useFakeTimers()
    const p = confirmDialog({ title: 'Поздний хост' })
    const host = mountHost(g.window!)
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS)
    expect(host.seen).toHaveLength(1)
    answerDialog(host.seen[0].id, true)
    await expect(p).resolves.toBe(true)
    expect(g.window!.confirm).not.toHaveBeenCalled()
    host.unmount()
  })
})

describe('нет хоста — нативное окно, действие не зависает', () => {
  it('confirm уходит в window.confirm с заголовком и текстом', async () => {
    vi.useFakeTimers()
    g.window!.confirm.mockReturnValue(false)
    const p = confirmDialog({ title: 'Удалить?', text: 'Отменить нельзя' })
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS)
    await expect(p).resolves.toBe(false)
    expect(g.window!.confirm).toHaveBeenCalledWith('Удалить?\n\nОтменить нельзя')
    expect(pendingDialogCount()).toBe(0)
  })

  it('prompt уходит в window.prompt со значением по умолчанию', async () => {
    vi.useFakeTimers()
    const p = promptDialog({ title: 'Ссылка', defaultValue: 'https://x' })
    await vi.advanceTimersByTimeAsync(HOST_WAIT_MS)
    await expect(p).resolves.toBe('из нативного')
    expect(g.window!.prompt).toHaveBeenCalledWith('Ссылка', 'https://x')
  })

  it('на сервере: confirm → false, prompt → null', async () => {
    delete g.window
    await expect(confirmDialog({ title: 'x' })).resolves.toBe(false)
    await expect(promptDialog({ title: 'x' })).resolves.toBeNull()
  })
})
