import { describe, it, expect } from 'vitest'
import {
  isReworkReason, pickReopen, REOPEN_TASK_PATCH, REWORK_REASONS,
  restartStageFor, type ReworkTask,
} from '@/lib/production/rework'

const t = (id: number, stage_key: string, sequence_order: number, status = 'done'): ReworkTask =>
  ({ id, stage_key, sequence_order, status })

describe('список причин — короткий, потому что этап уже известен', () => {
  it('пять причин, а не одиннадцать андон-кодов', () => {
    expect(REWORK_REASONS).toHaveLength(5)
  })

  it('«брак закалки» больше не причина — это место, оно приходит из stage_key', () => {
    const codes = REWORK_REASONS.map(r => r.code)
    expect(codes).not.toContain('tempering_defect')
    expect(codes).not.toContain('polishing_defect')
    expect(codes).not.toContain('drilling_defect')
  })

  it('«нет материала» выведен: это не брак, и у него своя работающая кнопка', () => {
    expect(REWORK_REASONS.map(r => r.code)).not.toContain('material_missing')
  })

  it('чужой код не принимается — причина обязательна и выбирается, а не печатается', () => {
    expect(isReworkReason('break')).toBe(true)
    expect(isReworkReason('tempering_defect')).toBe(false)
    expect(isReworkReason('')).toBe(false)
    expect(isReworkReason(null)).toBe(false)
  })
})

describe('restartStageFor — с какого этапа переделывать', () => {
  it('бой на полировке — деталь в лом, режем заново', () => {
    expect(restartStageFor('break', 'polishing')).toBe('cutting')
  })

  it('неверный размер — тоже с резки, размер задаётся там', () => {
    expect(restartStageFor('wrong_size', 'packaging')).toBe('cutting')
  })

  it('брак материала — с резки', () => {
    expect(restartStageFor('material_defect', 'tempering')).toBe('cutting')
  })

  it('царапина — с места обнаружения, деталь не обязательно в лом', () => {
    expect(restartStageFor('scratch', 'polishing')).toBe('polishing')
  })

  it('«другое» — с места обнаружения, гадать не за что', () => {
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
