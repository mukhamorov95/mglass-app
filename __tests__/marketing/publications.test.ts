import { describe, expect, it } from 'vitest'
import { leadsByPublication, shortId, trackedUrl, utmFor, type Publication } from '@/lib/marketing/publications'
import type { AmoLeadLite } from '@/lib/marketing/channels'

const ID = '3f2a9c1e-0b4d-4e8f-9a1b-2c3d4e5f6a7b'
const page = 'https://www.mglass-zerkala.ru/raboty/zerkala-s-podsvetkoj-zhk-subbota'

const pub = (over: Partial<Publication> = {}): Publication => ({
  id: ID, object_id: 'o1', platform: 'vk', url: null, target_url: page, status: 'published', published_at: '2026-11-25',
  ...utmFor('vk', 'zhk-subbota', ID), ...over,
})

const lead = (campaign: string, content: string): AmoLeadLite => ({
  id: 1, name: 'x', pipeline_id: 1, status_id: 1, created_at: 0,
  custom_fields_values: [
    { field_name: 'utm_campaign', values: [{ value: campaign }] },
    { field_name: 'utm_content', values: [{ value: content }] },
  ],
})

describe('реестр публикаций', () => {
  it('метки площадки: источник, канал, объект, id публикации', () => {
    expect(utmFor('vk', 'zhk-subbota', ID)).toEqual({ utm_source: 'vk', utm_medium: 'social', utm_campaign: 'zhk-subbota', utm_content: '3f2a9c1e' })
  })

  it('у страницы на сайте меток нет — ссылка без хвоста', () => {
    const p = pub({ platform: 'site', ...utmFor('site', 'zhk-subbota', ID) })
    expect(trackedUrl(p)).toBe(page)
  })

  it('ссылка с UTM собирается из полей', () => {
    expect(trackedUrl(pub())).toBe(`${page}?utm_source=vk&utm_medium=social&utm_campaign=zhk-subbota&utm_content=${shortId(ID)}`)
  })

  it('заявка находит публикацию по campaign + content, регистр не важен', () => {
    const m = leadsByPublication([lead('ZHK-SUBBOTA', '3F2A9C1E'), lead('zhk-subbota', 'other'), lead('', '')], [pub()])
    expect(m.get(ID)?.length).toBe(1)
  })

  it('публикация без меток заявок не собирает', () => {
    const m = leadsByPublication([lead('', '')], [pub({ utm_campaign: null, utm_content: null })])
    expect(m.size).toBe(0)
  })
})
