import { describe, it, expect } from 'vitest'
import { actorName, buildSyncDonePatch, buildTaskUpdate, UNSET_TASK_PATCH } from '@/lib/production/executor'

const actor = { id: 'u-1', name: 'Никита' }
const NOW = '2026-08-25T10:00:00.000Z'
const fresh = { status: 'queued', started_at: null, assigned_to: null }

describe('buildTaskUpdate — исполнитель без лишних действий (П1)', () => {
  it('«Готово» фиксирует исполнителя фактом и планом', () => {
    const upd = buildTaskUpdate('done', actor, fresh, NOW)
    expect(upd.completed_by).toBe('u-1')
    expect(upd.completed_by_name).toBe('Никита')
    expect(upd.assigned_to).toBe('u-1')
    expect(upd.completed_at).toBe(NOW)
    expect(upd.status).toBe('done')
  })

  it('чужое назначение не перетирается — план остаётся планом', () => {
    const upd = buildTaskUpdate('done', actor, { ...fresh, assigned_to: 'u-2' }, NOW)
    expect(upd.assigned_to).toBe('u-2')
    expect(upd.completed_by).toBe('u-1')   // факт всё равно за тем, кто нажал
  })

  it('«Готово» без «В работу» ставит started_at, иначе длительность этапа врёт (П4)', () => {
    expect(buildTaskUpdate('done', actor, fresh, NOW).started_at).toBe(NOW)
  })

  it('уже начатую задачу не перезапускает', () => {
    const started = { ...fresh, status: 'in_progress', started_at: '2026-08-25T08:00:00.000Z' }
    expect(buildTaskUpdate('done', actor, started, NOW).started_at).toBe('2026-08-25T08:00:00.000Z')
  })

  it('«Готово» снимает висящий андон', () => {
    expect(buildTaskUpdate('done', actor, fresh, NOW).problem_resolved_at).toBe(NOW)
  })

  it('«В работу» назначает задачу тому, кто её взял', () => {
    const upd = buildTaskUpdate('start', actor, fresh, NOW)
    expect(upd.status).toBe('in_progress')
    expect(upd.assigned_to).toBe('u-1')
    expect(upd.started_at).toBe(NOW)
    expect(upd.completed_by).toBeUndefined()
    expect(upd.started_via).toBe('button')   // явное нажатие — сильный сигнал (П2)
  })

  it('проблема помнит, кто её поднял', () => {
    const upd = buildTaskUpdate('problem', actor, fresh, NOW, { reasonCode: 'crack', comment: 'скол угла' })
    expect(upd.status).toBe('problem')
    expect(upd.problem_by).toBe('u-1')
    expect(upd.problem_by_name).toBe('Никита')
    expect(upd.problem_reason_code).toBe('crack')
    expect(upd.problem_comment).toBe('скол угла')
    expect(upd.problem_resolved_at).toBeNull()
  })

  it('проблема НЕ приватизирует задачу: после снятия андона её должна видеть станция', () => {
    expect(buildTaskUpdate('problem', actor, fresh, NOW).assigned_to).toBeUndefined()
  })

  it('причина по умолчанию — other, отметка не теряется из-за пустого повода', () => {
    expect(buildTaskUpdate('problem', actor, fresh, NOW).problem_reason_code).toBe('other')
  })
})

describe('отметка со старых экранов и её отмена', () => {
  it('карточка заказа / QR фиксируют того же исполнителя', () => {
    const patch = buildSyncDonePatch(actor, NOW)
    expect(patch.completed_by).toBe('u-1')
    expect(patch.completed_by_name).toBe('Никита')
    expect(patch.status).toBe('done')
  })

  it('отмена этапа снимает исполнителя — иначе он попал бы в выработку за невыполненное', () => {
    expect(UNSET_TASK_PATCH.completed_by).toBeNull()
    expect(UNSET_TASK_PATCH.completed_by_name).toBeNull()
    expect(UNSET_TASK_PATCH.problem_by).toBeNull()
    expect(UNSET_TASK_PATCH.started_via).toBeNull()   // прежний сигнал начала работы недействителен (П2)
    expect(UNSET_TASK_PATCH.status).toBe('queued')
  })
})

describe('actorName', () => {
  it('имя из профиля важнее почты', () => expect(actorName('Бекмурза', 'b@m.ru')).toBe('Бекмурза'))
  it('пустое имя падает на почту', () => expect(actorName('  ', 'b@m.ru')).toBe('b@m.ru'))
  it('нет ни того ни другого — null, а не пустая строка', () => expect(actorName(null, null)).toBeNull())
})
