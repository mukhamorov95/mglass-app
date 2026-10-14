import { describe, it, expect } from 'vitest'
import {
  isReworkReason, pickReopen, REOPEN_TASK_PATCH, REWORK_REASONS, REWORK_REASON_LABELS,
  restartStageFor, parseReworkBody, planRework, reopenedStageEntries, FOUND_AFTER_PRODUCTION,
  REWORK_COMMENT_MAX, type ReworkTask,
} from '@/lib/production/rework'

const t = (id: number, stage_key: string, sequence_order: number, status = 'done'): ReworkTask =>
  ({ id, stage_key, sequence_order, status })

describe('список причин — словами владельца', () => {
  it('шесть причин: бой при резке и при закалке, кромка, размер, рекламация, другое', () => {
    expect(REWORK_REASONS.map(r => r.code)).toEqual([
      'break_cutting', 'break_tempering', 'edge_defect', 'wrong_size', 'client_claim', 'other',
    ])
  })

  it('«нет материала» выведен: это не брак, и у него своя работающая кнопка', () => {
    expect(REWORK_REASONS.map(r => r.code)).not.toContain('material_missing')
  })

  it('чужой код не принимается — причина обязательна и выбирается, а не печатается', () => {
    expect(isReworkReason('break_tempering')).toBe(true)
    expect(isReworkReason('tempering_defect')).toBe(false)
    expect(isReworkReason('')).toBe(false)
    expect(isReworkReason(null)).toBe(false)
  })

  it('старые коды больше не пишутся, но строки с ними подписываются', () => {
    expect(isReworkReason('break')).toBe(false)
    expect(REWORK_REASON_LABELS.break).toBe('Бой / скол')
    expect(REWORK_REASON_LABELS.scratch).toBe('Царапина')
  })
})

describe('restartStageFor — с какого этапа переделывать', () => {
  it('бой при закалке — деталь в лом, режем заново', () => {
    expect(restartStageFor('break_tempering', 'tempering')).toBe('cutting')
  })

  it('бой при резке — с резки', () => {
    expect(restartStageFor('break_cutting', 'polishing')).toBe('cutting')
  })

  it('ошибка размера — тоже с резки, размер задаётся там', () => {
    expect(restartStageFor('wrong_size', 'packaging')).toBe('cutting')
  })

  it('старый «бой» читается так же — в лом', () => {
    expect(restartStageFor('break', 'polishing')).toBe('cutting')
  })

  it('брак кромки до закалки — с полировки', () => {
    const tasks = [t(1, 'cutting', 1), t(2, 'polishing', 2, 'done'), t(3, 'tempering', 3, 'queued')]
    expect(restartStageFor('edge_defect', 'tempering', tasks)).toBe('polishing')
  })

  it('брак кромки у закалённой детали — в лом: калёное стекло не шлифуют', () => {
    const tasks = [t(1, 'cutting', 1), t(2, 'polishing', 2), t(3, 'tempering', 3, 'done'), t(4, 'packaging', 4, 'queued')]
    expect(restartStageFor('edge_defect', 'packaging', tasks)).toBe('cutting')
  })

  it('рекламация и «другое» — с места обнаружения', () => {
    expect(restartStageFor('client_claim', 'packaging')).toBe('packaging')
    expect(restartStageFor('other', 'drilling')).toBe('drilling')
  })
})

describe('pickReopen — какие задачи вернуть в очередь', () => {
  const route = [t(1, 'cutting', 1), t(2, 'polishing', 2), t(3, 'tempering', 3), t(4, 'packaging', 4)]

  it('с резки переоткрывается весь маршрут', () => {
    expect(pickReopen(route, 'cutting').map(x => x.id)).toEqual([1, 2, 3, 4])
  })

  it('с полировки — она и всё, что после', () => {
    expect(pickReopen(route, 'polishing').map(x => x.id)).toEqual([2, 3, 4])
  })

  it('этапа нет в маршруте детали — не переоткрываем ничего вместо всего', () => {
    expect(pickReopen(route, 'facet')).toEqual([])
  })

  it('триплекс: резка живёт в нескольких слоях — берём порог по минимальному номеру', () => {
    // слой 1: резка(1) → закалка(2); слой 2: резка(3) → закалка(4); затем склейка(5), упаковка(6)
    const triplex = [
      t(11, 'cutting', 1), t(12, 'tempering', 2),
      t(13, 'cutting', 3), t(14, 'tempering', 4),
      t(15, 'triplex', 5), t(16, 'packaging', 6),
    ]
    // пересобрать пакет из одного нового стекла нельзя — переоткрывается весь
    expect(pickReopen(triplex, 'cutting').map(x => x.id)).toEqual([11, 12, 13, 14, 15, 16])
  })
})

describe('REOPEN_TASK_PATCH — переоткрытая задача чиста', () => {
  it('снимает исполнителя: этап предстоит сделать заново', () => {
    expect(REOPEN_TASK_PATCH.completed_by).toBeNull()
    expect(REOPEN_TASK_PATCH.completed_by_name).toBeNull()
    expect(REOPEN_TASK_PATCH.completed_at).toBeNull()
  })

  it('снимает сигнал начала работы', () => {
    expect(REOPEN_TASK_PATCH.started_by).toBeNull()
    expect(REOPEN_TASK_PATCH.started_via).toBeNull()
  })

  it('снимает каскадную отметку — иначе переделка осталась бы «закрытой автоматически»', () => {
    expect(REOPEN_TASK_PATCH.auto_closed).toBe(false)
  })

  it('возвращает задачу в очередь, а не в статус проблемы: брак — событие, а не висящий сигнал', () => {
    expect(REOPEN_TASK_PATCH.status).toBe('queued')
    expect(REOPEN_TASK_PATCH.problem_at).toBeNull()
  })
})

describe('parseReworkBody — вход действия с двух экранов', () => {
  it('очередь: задача и причина', () => {
    const r = parseReworkBody({ task_id: 42, reason: 'break_cutting' })
    expect(r).toEqual({ ok: true, value: { target: { taskId: 42 }, reason: 'break_cutting', comment: null, dryRun: false } })
  })

  it('карточка заказа: заказ + позиция, позиция 0 — валидна', () => {
    const r = parseReworkBody({ order_id: 7, item_index: 0, reason: 'client_claim', comment: '  трещина  ', dry_run: true })
    expect(r).toEqual({ ok: true, value: { target: { orderId: 7, itemIndex: 0 }, reason: 'client_claim', comment: 'трещина', dryRun: true } })
  })

  it('без позиции — отказ словами, а не запись на позицию 0', () => {
    expect(parseReworkBody({ order_id: 7, reason: 'other' })).toEqual({ ok: false, error: 'Не указана позиция' })
    expect(parseReworkBody({ order_id: 7, item_index: '', reason: 'other' })).toEqual({ ok: false, error: 'Не указана позиция' })
    expect(parseReworkBody({ order_id: 7, item_index: -1, reason: 'other' })).toEqual({ ok: false, error: 'Не указана позиция' })
  })

  it('без заказа и без задачи — отказ', () => {
    expect(parseReworkBody({ item_index: 1, reason: 'other' })).toEqual({ ok: false, error: 'Не указан заказ' })
    expect(parseReworkBody({ task_id: 'abc', reason: 'other' })).toEqual({ ok: false, error: 'Неверный id задачи' })
  })

  it('причина проверяется первой и только из списка', () => {
    expect(parseReworkBody({ task_id: 1, reason: 'break' })).toEqual({ ok: false, error: 'Неизвестная причина' })
    expect(parseReworkBody(null)).toEqual({ ok: false, error: 'Неизвестная причина' })
  })

  it('пустой комментарий — null, длинный обрезается', () => {
    const empty = parseReworkBody({ task_id: 1, reason: 'other', comment: '   ' })
    expect(empty.ok && empty.value.comment).toBeNull()
    const long = parseReworkBody({ task_id: 1, reason: 'other', comment: 'я'.repeat(REWORK_COMMENT_MAX + 50) })
    expect(long.ok && long.value.comment?.length).toBe(REWORK_COMMENT_MAX)
  })

  it('dry_run включается только явным true', () => {
    const r = parseReworkBody({ task_id: 1, reason: 'other', dry_run: 'yes' })
    expect(r.ok && r.value.dryRun).toBe(false)
  })
})

describe('planRework — где нашли и что переоткрыть', () => {
  const route = [
    t(1, 'cutting', 1), t(2, 'polishing', 2), t(3, 'tempering', 3, 'queued'), t(4, 'packaging', 4, 'queued'),
  ]

  it('карточка заказа: место — первый незакрытый этап позиции', () => {
    const p = planRework(route, 'break_tempering')
    expect(p.foundAtStage).toBe('tempering')
    expect(p.restartStage).toBe('cutting')
    expect(p.reopen.map(x => x.id)).toEqual([1, 2, 3, 4])
  })

  it('очередь: место — задача, на которой нажали, даже если раньше есть открытый этап', () => {
    const p = planRework(route, 'other', 4)
    expect(p.foundAtStage).toBe('packaging')
    expect(p.reopen.map(x => x.id)).toEqual([4])
  })

  it('порядок задач во входе не важен', () => {
    const p = planRework([...route].reverse(), 'edge_defect')
    expect(p.foundAtStage).toBe('tempering')
    expect(p.restartStage).toBe('polishing')
    expect(p.reopen.map(x => x.id)).toEqual([2, 3, 4])
  })

  it('рекламация на отгруженной позиции: «после цеха», маршрут не трогается', () => {
    const shipped = route.map(x => ({ ...x, status: 'done' }))
    const p = planRework(shipped, 'client_claim')
    expect(p.foundAtStage).toBe(FOUND_AFTER_PRODUCTION)
    expect(p.reopen).toEqual([])
  })

  it('бой у отгруженной позиции — деталь делают заново целиком', () => {
    const shipped = route.map(x => ({ ...x, status: 'done' }))
    expect(planRework(shipped, 'break_cutting').reopen.map(x => x.id)).toEqual([1, 2, 3, 4])
  })

  it('у позиции нет маршрута — запись без переоткрытия', () => {
    const p = planRework([], 'wrong_size')
    expect(p.foundAtStage).toBe(FOUND_AFTER_PRODUCTION)
    expect(p.reopen).toEqual([])
  })
})

describe('reopenedStageEntries — карточка заказа перестаёт показывать этап готовым', () => {
  it('по одной записи на этап, слои триплекса не дублируются', () => {
    const reopen = [t(11, 'cutting', 1), t(12, 'tempering', 2), t(13, 'cutting', 3), t(14, 'tempering', 4)]
    const e = reopenedStageEntries(2, reopen, { at: '2026-10-14T10:00:00Z', by: 'u1', reasonLabel: 'Бой при закалке' })
    expect(e.map(x => `${x.item}:${x.stage}`)).toEqual(['2:cutting', '2:tempering'])
    expect(e[0].entry).toEqual({ status: 'reopened', updated_at: '2026-10-14T10:00:00Z', updated_by: 'u1', reason: 'Переделка: Бой при закалке' })
  })

  it('статус не «done» — все читатели detail_stages сравнивают именно с ним', () => {
    const e = reopenedStageEntries(0, [t(1, 'cutting', 1)], { at: 'x', by: 'u', reasonLabel: 'r' })
    expect(e[0].entry.status).not.toBe('done')
  })
})
