import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  appendTo, COPY_DROP_KEYS, isOrderStatus, launchPatch, notesForCopy, parseOrderNotes, statusPatch,
} from '@/lib/b2b/orderNotes'

const AT = '2026-09-30T12:00:00.000Z'

// 30.09: экраны писали notes целиком из копии, прочитанной при открытии вкладки, и
// стирали ответ клиента по ссылке, согласование цены, этапы и оплату. Патч теперь
// собирается из свежих notes и несёт только свои ключи.
describe('statusPatch — свой ключ, история от свежей записи', () => {
  // Вкладка открыта утром: у неё статус «quote» и одна запись истории. Днём клиент
  // согласовал по ссылке — в свежей записи «agreed», ответ клиента и две записи.
  const fresh = {
    status: 'agreed',
    client_response: { action: 'approve', at: '2026-09-30T11:00:00Z' },
    status_history: [{ from: 'quote', to: 'sent' }, { from: 'sent', to: 'agreed', by: 'client' }],
    stages: { cutting: '2026-09-30' },
    payment_status: 'partial',
  }

  it('патч не содержит чужих ключей — ответ клиента, этапы, оплата не перезаписываются', () => {
    const p = statusPatch(fresh, 'confirmed', { at: AT })
    expect(Object.keys(p).sort()).toEqual(['status', 'status_history'])
  })

  it('история дописывается к свежей, «откуда» — из свежего статуса, а не из копии вкладки', () => {
    const p = statusPatch(fresh, 'confirmed', { at: AT })
    expect(p.status_history).toEqual([
      ...fresh.status_history,
      { from: 'agreed', to: 'confirmed', date: AT, comment: null },
    ])
  })

  it('комментарий пишется в status_comment, пустой — null', () => {
    expect(statusPatch({}, 'rejected', { at: AT, comment: '  дорого  ' }).status_comment).toBe('дорого')
    expect(statusPatch({}, 'rejected', { at: AT, comment: '   ' }).status_comment).toBeNull()
    expect('status_comment' in statusPatch({}, 'sent', { at: AT })).toBe(false)
  })

  it('возврат в черновик снимает launched_at null-ом (патч ключи не удаляет)', () => {
    expect(statusPatch(fresh, 'quote', { at: AT, revertToDraft: true }).launched_at).toBeNull()
    expect('launched_at' in statusPatch(fresh, 'sent', { at: AT, revertToDraft: true })).toBe(false)
  })

  it('без статуса в notes «откуда» — quote', () => {
    const p = statusPatch({}, 'sent', { at: AT })
    expect((p.status_history as { from: string }[])[0].from).toBe('quote')
  })
})

describe('launchPatch — запуск', () => {
  it('дата работы = дата запуска; срок и чертёж — только если есть', () => {
    const p = launchPatch({ status: 'agreed' }, { at: AT, workDate: '2026-10-01' })
    expect(p).toMatchObject({ status: 'sent', work_started_at: '2026-10-01', launched_at: '2026-10-01' })
    expect('deadline_date' in p).toBe(false)
    expect('drawing_url' in p).toBe(false)
    const q = launchPatch({}, { at: AT, workDate: '2026-10-01', deadline: '2026-10-15', drawingUrl: 'order-drawings/7.pdf' })
    expect(q).toMatchObject({ deadline_date: '2026-10-15', drawing_url: 'order-drawings/7.pdf' })
  })

  it('чертёж, этапы и ответ клиента, пришедшие после открытия вкладки, в патч не попадают', () => {
    const p = launchPatch({ drawing_url: 'order-drawings/7.jpg', client_response: {}, stages: {} }, { at: AT, workDate: '2026-10-01' })
    expect(Object.keys(p)).not.toContain('client_response')
    expect(Object.keys(p)).not.toContain('stages')
    expect(Object.keys(p)).not.toContain('drawing_url')
  })
})

describe('notesForCopy — копия не уносит жизнь исходного заказа', () => {
  const src = {
    status: 'sent', source: 'calculator', user_notes: 'крепёж клиента', production_days: 7,
    price_override: { target: 100000 }, kp_payment_terms: '100',
    public_token: 'tok_abc', share_log: [{}], client_response: { action: 'approve' },
    price_approval: { needed: true }, total_history: [{}], stages: { cutting: '2026-09-01' },
    payment_status: 'paid', paid_at: '2026-09-02', delivery: { method: 'pickup' }, claim: {},
    launched_at: '2026-09-01', status_history: [{}], is_template: true, template_name: 'Шаблон',
    manager_name: 'Прежний менеджер', quote_date: '2026-08-01',
  }
  const copy = notesForCopy(src, { at: AT, managerName: 'Новый менеджер' })

  it('токен ссылки клиента не копируется — иначе отправленная ссылка ведёт на два заказа и отдаёт 404', () => {
    expect(copy.public_token).toBeUndefined()
    expect(copy.share_log).toBeUndefined()
    expect(copy.client_response).toBeUndefined()
  })

  it('согласование, этапы, оплата, доставка, рекламация, история — не копируются', () => {
    for (const k of ['price_approval', 'total_history', 'stages', 'payment_status', 'paid_at', 'delivery', 'claim', 'launched_at', 'status_history', 'is_template', 'template_name']) {
      expect(copy[k]).toBeUndefined()
    }
  })

  it('содержимое просчёта остаётся; копия — черновик нового автора с новой датой', () => {
    expect(copy).toMatchObject({
      source: 'calculator', user_notes: 'крепёж клиента', production_days: 7,
      price_override: { target: 100000 }, kp_payment_terms: '100',
      status: 'quote', quote_date: AT, manager_name: 'Новый менеджер',
    })
  })

  it('каждый ключ, который пишут чужие патчи, стоит в списке сброса', () => {
    for (const k of ['public_opened_at', 'drawing_approval', 'ai_review', 'shipped_date', 'docs_printed', 'ship_backfill', 'material_status', 'urgent', 'deadline_date', 'detail_stages', 'repeated_from']) {
      expect(COPY_DROP_KEYS).toContain(k)
    }
  })
})

describe('мелочи', () => {
  it('parseOrderNotes: строка, объект, мусор', () => {
    expect(parseOrderNotes('{"a":1}')).toEqual({ a: 1 })
    expect(parseOrderNotes({ a: 1 })).toEqual({ a: 1 })
    expect(parseOrderNotes(null)).toEqual({})
    expect(parseOrderNotes('')).toEqual({})
    expect(parseOrderNotes('текст')).toEqual({})
    expect(parseOrderNotes('[1]')).toEqual({})
  })

  it('appendTo не мутирует свежую запись', () => {
    const fresh = { h: [1] }
    expect(appendTo(fresh, 'h', 2)).toEqual([1, 2])
    expect(fresh.h).toEqual([1])
    expect(appendTo({}, 'h', 1)).toEqual([1])
  })

  it('статусы обоих экранов допустимы, чужие — нет', () => {
    for (const s of ['quote', 'sent', 'agreed', 'confirmed', 'rejected', 'negotiation', 'in_production', 'completed', 'cancelled']) expect(isOrderStatus(s)).toBe(true)
    expect(isOrderStatus('pending_approval')).toBe(false)
    expect(isOrderStatus('paid')).toBe(false)
  })
})

// Страховка на будущее: инвариант «notes заказа пишет только точечный патч» держится,
// пока новая точка записи не напишет его целиком. Тест читает исходники и падает на
// любом update/upsert в b2b_orders, где среди полей есть notes. Исключение — с причиной.
describe('перепись писателей b2b_orders.notes', () => {
  const ALLOWED_FULL_NOTES: Record<string, string> = {
    // Выключен (501), пока не подключён провайдер оплат; при включении — через /api/b2b-orders/[id]/payment.
    'app/api/payments/webhook/route.ts': 'inactive',
  }
  // update(переменная): содержимое не видно — каждый файл проверен руками.
  const ALLOWED_VARIABLE_UPDATE: Record<string, string> = {
    'app/admin/archive/page.tsx': 'patch = { archived_at, updated_by_user_id }',
    'app/api/b2b-quotes/[id]/notes/route.ts': 'columns — без notes, notes идут патчем',
  }

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap(n => {
      const p = join(dir, n)
      if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : files(p)
      return /\.(ts|tsx)$/.test(n) ? [p] : []
    })
  }

  function argOf(s: string, open: number): string {
    let depth = 0
    for (let j = open; j < s.length; j++) {
      if (s[j] === '(') depth++
      else if (s[j] === ')' && --depth === 0) return s.slice(open, j + 1)
    }
    return s.slice(open)
  }

  const root = process.cwd()
  const all = ['app', 'lib', 'components'].flatMap(d => files(join(root, d)))
  const full: string[] = []
  const variable: string[] = []
  for (const p of all) {
    const rel = p.slice(root.length + 1)
    const s = readFileSync(p, 'utf8')
    for (const m of s.matchAll(/from\(\s*['"]b2b_orders['"]\s*\)\s*\.(update|upsert)\(/g)) {
      const arg = argOf(s, m.index! + m[0].length - 1)
      if (/^\(\s*[A-Za-z_][\w.]*\s*\)$/.test(arg)) { if (!ALLOWED_VARIABLE_UPDATE[rel]) variable.push(rel); continue }
      if (/\bnotes\b/.test(arg) && !ALLOWED_FULL_NOTES[rel]) full.push(rel)
    }
  }

  it('нашёл что проверять (иначе тест слепой)', () => {
    expect(all.length).toBeGreaterThan(100)
  })

  it('никто не пишет notes заказа целиком — только patch_order_notes_shallow / mark_*', () => {
    expect(full).toEqual([])
  })

  it('update(переменная) — только в проверенных файлах', () => {
    expect(variable).toEqual([])
  })
})
